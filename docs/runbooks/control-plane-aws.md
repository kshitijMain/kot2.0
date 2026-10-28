# Vendor Control Plane on AWS in Mumbai: setting it up

For the Business Owner, in the AWS web console, step by step. Steps marked **Engineer review**
should be checked by a cloud engineer before production. They can also be done by the engineer.
Do **staging first**. Production follows the same steps with the differences in
[Production](#12-production).

Background: what the service is and how it is run day to day is in `control-plane.md`. Its
settings are listed in `apps/control-plane/.env.example`. This guide covers manual tasks 23
(licence keys), 24 (error reporting), 26 (backup bucket), 32 (rate limits at the edge) and 34
(log store and operator host) where they touch AWS.

**Never paste a password, key or token into a Claude session, an e-mail, a ticket or the
repository.** Values go straight from where they are made into AWS Secrets Manager.

## What you will build

```
 Internet ── HTTPS ──> Load balancer (certificate for cp-staging.<your domain>, WAF rate limits)
                           │  HTTP, inside the private network
                           v
                 Container service (ECS Fargate): the Control Plane image from GitHub
                   │ reads secrets at start          │ writes logs (kept 180 days)
                   v                                  v
          Secrets Manager (+ KMS key for licences)   CloudWatch Logs
                   │
                   v
          PostgreSQL 16 (RDS, private, TLS only)      S3 bucket for restaurant backups
                                                      (versioning, Object Lock)
```

Everything is in **Asia Pacific (Mumbai) ap-south-1** (VCP-009, DATA-003).

## Names used in this guide

Use exactly these names for staging; production replaces `staging` with `production`.

| Thing                         | Name                                                       |
| ----------------------------- | ---------------------------------------------------------- |
| Network (VPC)                 | `rp-staging`                                               |
| Security groups               | `rp-staging-alb`, `rp-staging-cp`, `rp-staging-db`         |
| Database                      | `rp-staging-cp`, database `control_plane`, user `cp_admin` |
| KMS key for licences          | `alias/rp-staging-licences`                                |
| Secrets                       | `rp/staging/control-plane`, `rp/staging/licence`           |
| Backup bucket                 | `rp-backups-staging-<something unique>`                    |
| Log group                     | `/rp/staging/control-plane`                                |
| Image repository (shared)     | `rp-control-plane`                                         |
| Container cluster and service | `rp-staging`, `control-plane`                              |
| Task definition               | `rp-staging-control-plane`                                 |
| Address                       | `cp-staging.<your domain>`                                 |

## 0. Before you start

You need:

- an AWS account, with MFA on the root user, and an administrator user of your own (IAM
  Identity Center or IAM, with MFA) for everyday work. Do not use the root user for these steps;
- your domain, and the login of whoever runs its DNS (your registrar, Cloudflare, Route 53...);
- admin access to the GitHub repository `kshitijMain/kot2.0`;
- about half a day for staging.

Every time you open a service in the console, check the region at the top right says
**Asia Pacific (Mumbai)**. Most mistakes come from creating something in another region.

**Engineer review: accounts.** This guide puts staging and production in one AWS account, with
separate resources. Separate accounts under AWS Organizations, with production locked down
further, are stronger (VCP-009). Decide this before production.

### 0.1 A budget alarm (5 minutes)

1. Search for **Billing and Cost Management**, then **Budgets**, then **Create budget**.
2. **Use a template**, **Monthly cost budget**. Name `rp-monthly`. Amount: what you expect (see
   [Monthly costs](#13-monthly-costs)). E-mail: yours.
3. **Create budget**. AWS e-mails you at 85 % and 100 % of the amount.

### 0.2 CloudTrail (5 minutes)

CloudTrail records who did what in the account, including who ran the admin commands in step 9
(threat CP-R2).

1. **CloudTrail**, **Create trail**. Name `rp-account-trail`. Create a new S3 bucket for it,
   leave the rest, **Create trail**.

## 1. The network

1. **VPC**, **Create VPC**, choose **VPC and more**.
2. Name tag auto-generation: `rp-staging`.
3. Availability Zones: **2**. Public subnets: **2**. Private subnets: **2**.
4. NAT gateways: **In 1 AZ** (production: **1 per AZ**). The containers live in the private
   subnets and reach GitHub's image, Secrets Manager, WhatsApp and Sentry through it.
5. VPC endpoints: **S3 Gateway** (free; S3 traffic then skips the NAT gateway).
6. **Create VPC**.

**Engineer review: network.** NAT gateways are one of the larger fixed costs. For staging, the
engineer may put the containers in public subnets with a public IP instead (inbound still only
from the load balancer), or add VPC interface endpoints.

### 1.1 Security groups (three firewalls)

**EC2**, **Security groups**, **Create security group**, in VPC `rp-staging`, three times:

| Name             | Inbound rule                                                               | Used by       |
| ---------------- | -------------------------------------------------------------------------- | ------------- |
| `rp-staging-alb` | HTTPS 443 from `0.0.0.0/0`; HTTP 80 from `0.0.0.0/0` (redirected to HTTPS) | Load balancer |
| `rp-staging-cp`  | Custom TCP 8090 from the security group `rp-staging-alb`                   | Containers    |
| `rp-staging-db`  | PostgreSQL 5432 from the security group `rp-staging-cp`                    | Database      |

Leave outbound as "All traffic". Nothing else may reach the database (manual task 34, step 4).

## 2. The database (RDS PostgreSQL 16, TLS only)

1. **RDS**, **Create database**, **Standard create**, **PostgreSQL**.
2. Engine version: the newest **PostgreSQL 16.x**.
3. Templates: **Dev/Test** (production: **Production**, which turns on Multi-AZ).
4. DB instance identifier `rp-staging-cp`. Master username `cp_admin`.
5. Credentials management: **Self managed**, tick **Auto generate password**. You do not need
   to note it: step 5.3 replaces it with one nobody sees.
   (Do not choose "Managed in AWS Secrets Manager": it changes the password every week, and the
   Control Plane would lose its connection.)
6. Instance: **Burstable**, `db.t4g.micro` (production: `db.t4g.medium` or larger).
7. Storage: **gp3**, 20 GiB, storage autoscaling on, maximum 100 GiB.
8. Connectivity:
   - Compute resource: **Don't connect to an EC2 compute resource**.
   - VPC: `rp-staging`. DB subnet group: **Create new DB subnet group** (it picks the private
     subnets).
   - Public access: **No**.
   - VPC security group: **Choose existing**, `rp-staging-db` only (remove `default`).
   - Certificate authority: **rds-ca-rsa2048-g1** (the image trusts this one).
9. Database authentication: **Password authentication**.
10. **Additional configuration**:
    - Initial database name: `control_plane`.
    - DB parameter group: the default for postgres16. In PostgreSQL 16 on RDS it has
      `rds.force_ssl = 1`, which refuses any connection without TLS.
    - Backup retention: 7 days (production: 35 days).
    - Encryption: on (default key).
    - Log exports: **PostgreSQL log**.
    - Deletion protection: **on**.
11. **Create database**. It takes 10 to 20 minutes. Carry on meanwhile.

**Engineer review: database.**

- Confirm `rds.force_ssl` is 1 in the parameter group in use.
- The service connects as the master user `cp_admin`. A separate login for the service, with only
  the rights it needs, is better; the audit log is protected by a trigger either way.
- Production: Multi-AZ, Performance Insights, and whether to copy backups to Hyderabad
  (ap-south-2) for disaster recovery.

## 3. The image repository and GitHub

The image is built and scanned by GitHub (`.github/workflows/control-plane-image.yml`), never on
a laptop. GitHub pushes it to Amazon ECR without any stored AWS key: it proves who it is with a
short-lived token (OIDC).

### 3.1 The repository (ECR)

1. **Elastic Container Registry**, **Create repository**, Private, name `rp-control-plane`.
2. Image tag mutability: **Immutable**. Encryption: AES-256.
3. **Create**. Open it, **Lifecycle policy**, a rule "keep the last 30 images" (image count
   more than 30, expire).
4. Copy its URI, like `123456789012.dkr.ecr.ap-south-1.amazonaws.com/rp-control-plane`.
5. **Private registry**, **Settings** (or **Scanning configuration**): scan on push, basic
   scanning, for all repositories. This second scan sees new vulnerabilities in old images.

### 3.2 GitHub's identity in AWS

1. **IAM**, **Identity providers**, **Add provider**, **OpenID Connect**.
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`
2. **IAM**, **Roles**, **Create role**, **Custom trust policy**, paste (with your 12-digit
   account ID):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
         },
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Condition": {
           "StringEquals": {
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
             "token.actions.githubusercontent.com:sub": "repo:kshitijMain/kot2.0:environment:control-plane-registry"
           }
         }
       }
     ]
   }
   ```

3. **Next**, attach no managed policy, name it `rp-github-ecr-push`, **Create role**.
4. Open the role, **Add permissions**, **Create inline policy**, **JSON**, paste, name it
   `push-control-plane-image`:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*" },
       {
         "Effect": "Allow",
         "Action": [
           "ecr:BatchCheckLayerAvailability",
           "ecr:BatchGetImage",
           "ecr:CompleteLayerUpload",
           "ecr:DescribeImages",
           "ecr:GetDownloadUrlForLayer",
           "ecr:InitiateLayerUpload",
           "ecr:PutImage",
           "ecr:UploadLayerPart"
         ],
         "Resource": "arn:aws:ecr:ap-south-1:<ACCOUNT_ID>:repository/rp-control-plane"
       }
     ]
   }
   ```

5. Copy the role's ARN (`arn:aws:iam::<ACCOUNT_ID>:role/rp-github-ecr-push`).

### 3.3 GitHub settings

1. In the repository on GitHub, **Settings**, **Environments**, **New environment**
   `control-plane-registry`. Deployment branches: **Selected branches**, add `main`.
2. **Settings**, **Secrets and variables**, **Actions**, **Variables** tab (not Secrets: these
   two are not secret), **New repository variable**:
   - `CP_ECR_REPOSITORY` = the URI from 3.1 step 4;
   - `CP_AWS_ROLE_ARN` = the ARN from 3.2 step 5.
3. **Actions**, **Control Plane image**, **Run workflow** on `main`. When it is green, open the
   run: the summary shows **Image for the task definition**, like
   `...amazonaws.com/rp-control-plane@sha256:...`. Copy it; it is the exact image you run.

The build job fails on fixable high or critical vulnerabilities and on any secret found in the
image. Findings also appear under **Security**, **Code scanning**.

**Engineer review: pipeline.** The trust policy lets only the `control-plane-registry`
environment on `main` push. Check that `main` is protected (MANUAL_TASKS section 1).

## 4. Logs kept 180 days

1. **CloudWatch**, **Log groups**, **Create log group**.
2. Name `/rp/staging/control-plane`. Retention: **180 days** (SEC-015). **Create**.
3. Open it, **Metric filters**, **Create metric filter**. Pattern:

   ```
   { $.event = "audit" && ($.action = "vendor.sign_in_failed*" || $.action = "vendor.step_up_failed*") }
   ```

   Name `failed-vendor-sign-ins`, metric namespace `rp/control-plane`, metric value `1`.

4. Select the new metric filter, **Create alarm**: greater than 10 in 5 minutes, send to a new
   SNS topic with the Super Admins' e-mails. Confirm the subscription e-mail AWS sends.

**Engineer review: logs** (manual task 34). Only an operator or break-glass role may delete the
log group or shorten its retention; no everyday user can (threat CP-T5). This is a deny in a
permission boundary or a service control policy.

## 5. Keys and secrets

The Control Plane reads its secrets from environment variables. ECS fills them from Secrets
Manager when a container starts. You make them in **AWS CloudShell**, a terminal in the browser
that is already signed in as you. The values go straight into Secrets Manager; none is shown on
the screen.

Open CloudShell: the `>_` icon at the top of the console (check: Mumbai).

### 5.1 The role the containers start with

1. **IAM**, **Roles**, **Create role**, **AWS service**, **Elastic Container Service**, use case
   **Elastic Container Service Task**, **Next**.
2. Attach `AmazonECSTaskExecutionRolePolicy`. Name `rp-staging-cp-execution`. **Create role**.

The containers need no other AWS role today: S3 and KMS are reached with their own keys (5.5).

### 5.2 The KMS key for licences

1. **Key Management Service**, **Customer managed keys**, **Create key**.
2. **Symmetric**, **Encrypt and decrypt**, **Next**.
3. Alias `rp-staging-licences`. Description "Protects the licence signing key in Secrets Manager".
4. Key administrators: the two named vendor administrators (manual task 23). Key users:
   `rp-staging-cp-execution`. **Finish**.
5. Copy the key's ARN.

**Engineer review: licence key** (manual task 23). The software signs licences with an Ed25519
key it reads from `CP_LICENCE_SIGNING_KEY`, so today the key is made once in CloudShell, kept in
Secrets Manager under this KMS key, and readable only by the containers' start role and the two
administrators. Best is a key that never leaves KMS: if AWS KMS in Mumbai offers an Ed25519
signing key, ask Claude for a KMS signer. Also tighten the key policy so that AdministratorAccess
alone does not grant decryption.

### 5.3 The secrets

Paste this into CloudShell as one block. It makes the two secrets and prints only the licence
public key, which is not secret (send it to Claude or open a pull request for
`packages/licensing/src/vendor-keys.ts`, manual task 23 step 4). Staging and production each get
their own signing key, so a staging licence never works on a production PC.

```bash
(
set -euo pipefail
ENV=staging
LICENCE_KEY="$(openssl genpkey -algorithm ed25519 -outform DER | base64 -w0)"
aws secretsmanager create-secret --region ap-south-1 --name "rp/$ENV/licence" \
  --description "Control Plane $ENV: licence signing and reactivation keys" \
  --kms-key-id "alias/rp-$ENV-licences" \
  --secret-string "$(jq -n --arg sign "$LICENCE_KEY" --arg react "$(openssl rand -base64 32)" \
    '{CP_LICENCE_SIGNING_KEY: $sign, CP_LICENCE_REACTIVATION_KEY: $react}')" > /dev/null
aws secretsmanager create-secret --region ap-south-1 --name "rp/$ENV/control-plane" \
  --description "Control Plane $ENV: database, own secrets and outside services" \
  --secret-string "$(jq -n --arg key "$(openssl rand -base64 32)" --arg bill "$(openssl rand -base64 32)" '{
    DATABASE_URL: "", CP_SECRET_KEY: $key, CP_DIGITAL_BILL_KEY: $bill,
    CP_BACKUP_S3_ACCESS_KEY_ID: "", CP_BACKUP_S3_SECRET_ACCESS_KEY: "",
    CP_ESCROW_KMS_ACCESS_KEY_ID: "", CP_ESCROW_KMS_SECRET_ACCESS_KEY: "",
    CP_ERROR_DSN: "", CP_ALERT_WEBHOOK_URL: "", CP_RELAY_DATABASE_URL: "",
    CP_WHATSAPP_TOKEN: "", CP_WHATSAPP_PHONE_NUMBER_ID: ""}')" > /dev/null
echo "Licence public key for $ENV (SPKI DER, base64):"
echo "$LICENCE_KEY" | base64 -d | openssl pkey -inform DER -pubout -outform DER | base64 -w0; echo
)
```

Then, once the database from step 2 shows **Available**, paste this. It gives the database a new
random password and stores the connection string; the password is never shown.

```bash
(
set -euo pipefail
ENV=staging
PASSWORD="$(openssl rand -hex 24)"
aws rds modify-db-instance --region ap-south-1 --db-instance-identifier "rp-$ENV-cp" \
  --master-user-password "$PASSWORD" --apply-immediately > /dev/null
HOST="$(aws rds describe-db-instances --region ap-south-1 --db-instance-identifier "rp-$ENV-cp" \
  --query 'DBInstances[0].Endpoint.Address' --output text)"
CURRENT="$(aws secretsmanager get-secret-value --region ap-south-1 --secret-id "rp/$ENV/control-plane" \
  --query SecretString --output text)"
aws secretsmanager put-secret-value --region ap-south-1 --secret-id "rp/$ENV/control-plane" \
  --secret-string "$(jq --arg url "postgresql://cp_admin:$PASSWORD@$HOST:5432/control_plane?sslmode=require" \
    '.DATABASE_URL = $url' <<< "$CURRENT")" > /dev/null
echo "DATABASE_URL stored for $HOST"
)
```

Use `sslmode=require`, not `verify-full`. The service's driver already treats `require` as
`verify-full`: it checks the certificate and the host name against the RDS authorities built into
the image. Prisma's migration tool does not know `verify-full` and would connect without TLS.

In **Secrets Manager**, open each secret and copy its **Secret ARN** (it ends in six random
characters). You need both in step 6.

**Engineer review: secrets.** Check the values exist without reading them (**Secrets Manager**,
the secret, **Retrieve secret value** shows them; only do this if needed). Plan a password
rotation for `DATABASE_URL` (a new password here, then a new deployment).

### 5.4 Let the start role read them

**IAM**, role `rp-staging-cp-execution`, **Add permissions**, **Create inline policy**, **JSON**,
name `read-control-plane-secrets`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": ["<CONTROL_PLANE_SECRET_ARN>", "<LICENCE_SECRET_ARN>"]
    },
    { "Effect": "Allow", "Action": "kms:Decrypt", "Resource": "<LICENCE_KMS_KEY_ARN>" }
  ]
}
```

### 5.5 The backup bucket (S3, versioning and Object Lock)

Follow `manual-tasks/26-cloud-backup-storage.md` sections 1 and 2, with these points:

1. **S3**, **Create bucket**, General purpose, name `rp-backups-staging-<something unique>`
   (bucket names are global), region Mumbai.
2. Block all public access: on. Bucket Versioning: **Enable**. Default encryption: SSE-S3.
3. **Advanced settings**, Object Lock: **Enable** (only possible now), tick the acknowledgement.
   **Create bucket**.
4. Open the bucket, **Properties**, **Object Lock**, **Edit**: default retention on,
   **Governance**, **35 days**.
5. **Management**, the two lifecycle rules of manual task 26 (incomplete uploads after 3 days;
   noncurrent versions deleted after 36 days, with expired delete markers).
6. **IAM**, **Users**, **Create user** `rp-staging-cp-backups` (no console access). Add the
   inline policy from manual task 26 section 2, with your bucket name.
7. Open the user, **Security credentials**, **Create access key**, "Application running outside
   AWS". The console shows the pair once. Paste them directly into **Secrets Manager**,
   `rp/staging/control-plane`, **Retrieve secret value**, **Edit**, as
   `CP_BACKUP_S3_ACCESS_KEY_ID` and `CP_BACKUP_S3_SECRET_ACCESS_KEY`. **Save**. Close the tab with
   the keys.

Key escrow for backups (manual task 27) works the same way: its KMS key and access key pair, put
into `CP_ESCROW_KMS_ACCESS_KEY_ID` and `CP_ESCROW_KMS_SECRET_ACCESS_KEY`, plus two environment
variables in step 6. Do it when the restore policy (OI-10) is decided.

**Engineer review: access keys.** S3 and KMS are reached with an IAM user's long-lived keys,
because the Control Plane reads them from its settings. Rotate them yearly. Better: ask Claude to
let the Control Plane use the container's own role, so there are no keys to keep.

### 5.6 The other outside services (when you have them)

Each goes into `rp/staging/control-plane` the same way (**Edit**, paste the value, **Save**), then
a new deployment (step 10):

| Key                                                | What                                             | Where it comes from |
| -------------------------------------------------- | ------------------------------------------------ | ------------------- |
| `CP_ERROR_DSN`                                     | Sentry DSN of the `control-plane` project        | manual task 24      |
| `CP_ALERT_WEBHOOK_URL`                             | Slack or Teams incoming webhook for fleet alerts | your chat tool      |
| `CP_RELAY_DATABASE_URL`                            | the QR relay's `relay_control_plane` login       | manual task 20      |
| `CP_WHATSAPP_TOKEN`, `CP_WHATSAPP_PHONE_NUMBER_ID` | digital bills on WhatsApp (both or neither)      | manual task 28      |

Empty values are treated as not set, so the service starts without them.

## 6. The task definition (what to run, with which settings)

1. **Elastic Container Service**, **Task definitions**, **Create new task definition**,
   **Create new task definition with JSON**.
2. Paste the JSON below, after replacing everything in `<...>`:
   - `<IMAGE>`: the image line from step 3.3, `...rp-control-plane@sha256:...`;
   - `<ACCOUNT_ID>`, `<CONTROL_PLANE_SECRET_ARN>`, `<LICENCE_SECRET_ARN>`: from step 5;
   - `<BACKUP_BUCKET>`: your bucket's name; `<your domain>`: your domain.
3. **Create**.

```json
{
  "family": "rp-staging-control-plane",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "runtimePlatform": { "operatingSystemFamily": "LINUX", "cpuArchitecture": "X86_64" },
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::<ACCOUNT_ID>:role/rp-staging-cp-execution",
  "containerDefinitions": [
    {
      "name": "control-plane",
      "image": "<IMAGE>",
      "essential": true,
      "portMappings": [{ "containerPort": 8090, "protocol": "tcp" }],
      "environment": [
        { "name": "CP_ENV", "value": "staging" },
        { "name": "CP_TRUST_PROXY", "value": "1" },
        { "name": "CP_PUBLIC_URL", "value": "https://cp-staging.<your domain>" },
        { "name": "LOG_LEVEL", "value": "info" },
        { "name": "CP_BACKUP_STORE", "value": "s3" },
        { "name": "CP_BACKUP_S3_REGION", "value": "ap-south-1" },
        { "name": "CP_BACKUP_S3_ENDPOINT", "value": "https://s3.ap-south-1.amazonaws.com" },
        { "name": "CP_BACKUP_S3_BUCKET", "value": "<BACKUP_BUCKET>" }
      ],
      "secrets": [
        { "name": "DATABASE_URL", "valueFrom": "<CONTROL_PLANE_SECRET_ARN>:DATABASE_URL::" },
        { "name": "CP_SECRET_KEY", "valueFrom": "<CONTROL_PLANE_SECRET_ARN>:CP_SECRET_KEY::" },
        {
          "name": "CP_DIGITAL_BILL_KEY",
          "valueFrom": "<CONTROL_PLANE_SECRET_ARN>:CP_DIGITAL_BILL_KEY::"
        },
        {
          "name": "CP_BACKUP_S3_ACCESS_KEY_ID",
          "valueFrom": "<CONTROL_PLANE_SECRET_ARN>:CP_BACKUP_S3_ACCESS_KEY_ID::"
        },
        {
          "name": "CP_BACKUP_S3_SECRET_ACCESS_KEY",
          "valueFrom": "<CONTROL_PLANE_SECRET_ARN>:CP_BACKUP_S3_SECRET_ACCESS_KEY::"
        },
        {
          "name": "CP_ESCROW_KMS_ACCESS_KEY_ID",
          "valueFrom": "<CONTROL_PLANE_SECRET_ARN>:CP_ESCROW_KMS_ACCESS_KEY_ID::"
        },
        {
          "name": "CP_ESCROW_KMS_SECRET_ACCESS_KEY",
          "valueFrom": "<CONTROL_PLANE_SECRET_ARN>:CP_ESCROW_KMS_SECRET_ACCESS_KEY::"
        },
        { "name": "CP_ERROR_DSN", "valueFrom": "<CONTROL_PLANE_SECRET_ARN>:CP_ERROR_DSN::" },
        {
          "name": "CP_ALERT_WEBHOOK_URL",
          "valueFrom": "<CONTROL_PLANE_SECRET_ARN>:CP_ALERT_WEBHOOK_URL::"
        },
        {
          "name": "CP_RELAY_DATABASE_URL",
          "valueFrom": "<CONTROL_PLANE_SECRET_ARN>:CP_RELAY_DATABASE_URL::"
        },
        {
          "name": "CP_WHATSAPP_TOKEN",
          "valueFrom": "<CONTROL_PLANE_SECRET_ARN>:CP_WHATSAPP_TOKEN::"
        },
        {
          "name": "CP_WHATSAPP_PHONE_NUMBER_ID",
          "valueFrom": "<CONTROL_PLANE_SECRET_ARN>:CP_WHATSAPP_PHONE_NUMBER_ID::"
        },
        {
          "name": "CP_LICENCE_SIGNING_KEY",
          "valueFrom": "<LICENCE_SECRET_ARN>:CP_LICENCE_SIGNING_KEY::"
        },
        {
          "name": "CP_LICENCE_REACTIVATION_KEY",
          "valueFrom": "<LICENCE_SECRET_ARN>:CP_LICENCE_REACTIVATION_KEY::"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/rp/staging/control-plane",
          "awslogs-region": "ap-south-1",
          "awslogs-stream-prefix": "cp"
        }
      },
      "healthCheck": {
        "command": [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:8090/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
        ],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 30
      },
      "linuxParameters": { "initProcessEnabled": true },
      "stopTimeout": 30
    }
  ]
}
```

What the settings mean:

| Variable                                 | Value                    | Why                                                                                           |
| ---------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| `CP_ENV`                                 | `staging` / `production` | Turns on HSTS and the checks that refuse an unsafe setup.                                     |
| `CP_TRUST_PROXY`                         | `1`                      | One proxy (the load balancer) in front; WAF adds none. With CloudFront in front as well, `2`. |
| `CP_PUBLIC_URL`                          | `https://cp-staging...`  | The address in digital bill links.                                                            |
| `CP_BACKUP_*`                            | S3 in Mumbai             | Restaurant backups (DATA-003). Another region is refused.                                     |
| `HOST`, `PORT`, `CP_WEB_DIR`, `NODE_ENV` | set in the image         | `0.0.0.0`, `8090`, the web app in `/app/web`.                                                 |
| Everything else                          | not set                  | The defaults in `apps/control-plane/.env.example` apply.                                      |

Later, for key escrow (manual task 27), add `CP_ESCROW_KMS_KEY_ID` (`alias/rp-backup-escrow-staging`)
and `CP_ESCROW_KMS_REGION` (`ap-south-1`) to `environment`.

The service refuses to start, and names the setting, when one is wrong: for example no
`CP_SECRET_KEY`, a database URL without `sslmode=require`, or an `http://` address for an outside
service. The reason is in the log group.

**Engineer review: task definition.** CPU and memory (0.5 vCPU and 1 GB are a starting point).
ARM (Graviton) costs less but needs an arm64 image. A read-only root file system is possible for
the service; test that migrations still run before turning it on.

## 7. The cluster

**Elastic Container Service**, **Clusters**, **Create cluster**, name `rp-staging`,
infrastructure **AWS Fargate** only. **Create**.

## 8. Migrations (before the first start, and before every new version)

1. Cluster `rp-staging`, **Tasks** tab, **Run new task**.
2. Compute options: **Launch type**, **FARGATE**, platform **LATEST**.
3. Deployment configuration: application type **Task**, family `rp-staging-control-plane`, the
   newest revision.
4. Networking: VPC `rp-staging`, the two **private** subnets, security group `rp-staging-cp` only,
   public IP **off**.
5. **Container overrides**, `control-plane`, Command override:

   ```
   node,node_modules/prisma/build/index.js,migrate,deploy
   ```

6. **Create**. Open the task, **Logs** tab. It ends with "All migrations have been successfully
   applied." (or "No pending migrations to apply.") and the task stops with exit code 0.

Migrations only go forward: an older version of the service cannot run on a newer database
(UPD-005).

## 9. The address, the certificate and the load balancer

### 9.1 The certificate

1. **Certificate Manager**, **Request**, public certificate, domain `cp-staging.<your domain>`,
   **DNS validation**. **Request**.
2. Open it. Add the **CNAME name** and **CNAME value** it shows at your DNS provider. After a few
   minutes the status becomes **Issued**. Keep the CNAME: renewals use it.

### 9.2 The target group

1. **EC2**, **Target groups**, **Create target group**, type **IP addresses**, name
   `rp-staging-cp`, protocol **HTTP**, port **8090**, VPC `rp-staging`.
2. Health checks: path `/v1/health`. **Advanced**: healthy threshold 2, interval 15 seconds,
   success codes 200.
3. **Next**. Register no targets (ECS does). **Create target group**.

### 9.3 The load balancer

1. **EC2**, **Load balancers**, **Create**, **Application Load Balancer**.
2. Name `rp-staging`, **Internet-facing**, IPv4. VPC `rp-staging`, the two **public** subnets.
   Security group `rp-staging-alb` only.
3. Listener **HTTPS 443**, forward to `rp-staging-cp`. Security policy
   `ELBSecurityPolicy-TLS13-1-2-2021-06` (TLS 1.2 and 1.3). Certificate: from ACM,
   `cp-staging.<your domain>`.
4. **Create load balancer**. Open it, **Listeners**, **Add listener**: **HTTP 80**, action
   **Redirect to URL**, HTTPS, port 443, status 301.
5. **Attributes**, **Edit**: **Drop invalid header fields** on. Leave the idle timeout at 60
   seconds.
6. Copy its **DNS name**. At your DNS provider add a **CNAME** record `cp-staging` pointing to it
   (Route 53: an **A** record, **Alias** to the load balancer).

The service must be served at the root of its address (`https://cp-staging.<your domain>/`). Do
not add a path to the forwarding rule: restaurant PCs sign the path of each request.

### 9.4 Rate limits at the edge (WAF, manual task 32)

1. **WAF & Shield**, **Web ACLs**, region Mumbai, **Create web ACL**. Resource type **Regional**,
   name `rp-staging-cp`, **Add AWS resources**: the load balancer `rp-staging`.
2. **Add rules**, **Add my own rules**, **Rule builder**, type **Rate-based rule**, evaluation
   window 1 minute, aggregate on **Source IP address**, action **Block** with a custom response:
   code **429** and a header `Retry-After` = `60`. Three rules, each with "Only consider requests
   that match the criteria in a rule statement":

   | Rule         | Limit a minute | Requests counted                                                                    |
   | ------------ | -------------- | ----------------------------------------------------------------------------------- |
   | `cp-sign-in` | 60             | URI path starts with `/v1/enrolments` or `/v1/vendor/session` or `/v1/vendor/setup` |
   | `cp-bills`   | 120            | URI path starts with `/v1/bills/`                                                   |
   | `cp-all`     | 600            | URI path starts with `/v1/` and is **not** exactly `/v1/health`                     |

3. Default action **Allow**. **Create web ACL**.

**Engineer review: edge.** Check the rules against `infra/edge/README.md` ("What the edge must
do"), then run `infra/edge/check-edge.mjs` against staging as it describes. Both checks must pass
before the penetration test.

## 10. The service

1. Cluster `rp-staging`, **Services**, **Create**.
2. Compute: **Launch type** FARGATE, LATEST. Application type **Service**, family
   `rp-staging-control-plane`, newest revision, service name `control-plane`, desired tasks **1**
   (production: **2**).
3. Deployment options: **Rolling update**, minimum 100 %, maximum 200 %. **Deployment failure
   detection**: circuit breaker on, **rollback on failures**.
4. Networking: VPC `rp-staging`, the two **private** subnets, security group `rp-staging-cp` only,
   public IP **off**.
5. Load balancing: **Application Load Balancer**, **Use an existing load balancer** `rp-staging`,
   container `control-plane 8090`, **existing listener** 443, **existing target group**
   `rp-staging-cp`. Health check grace period: 60 seconds.
6. **Create**. After two or three minutes the service shows **1/1 tasks running** and the target
   group shows the target **healthy**.

If the task keeps stopping: open the stopped task, **Logs**. "Invalid Control Plane
configuration: ..." names the setting to fix; "ResourceInitializationError" means a secret ARN or
the start role's permissions in step 5.4. Should it name a key whose value is still empty, remove
that line from the task definition's `secrets` until the value exists (**Engineer review**).

## 11. The first Super Admin, and checking it works

### 11.1 Create the account

1. **Run new task** as in step 8, with this command override (your e-mail and name):

   ```
   node,dist/cli.js,vendor-user:create,--email,<you@your domain>,--name,<Your Name>,--role,SUPER_ADMIN
   ```

   and, under **Environment variable overrides**, `CP_ACTOR` = `cli:<your name>` (the audit log
   records who ran it).

2. **Create**. When the task has stopped, its **Logs** show the setup link:
   `https://cp-staging.<your domain>/setup#...`.
3. Open the link **right away**, in a normal browser: choose a password and add an authenticator
   app. The link works once, for 72 hours.

The setup link stays in the log for 180 days, but it is useless once used. Use it the same day.

**Engineer review: operator access** (manual task 34, threat CP-R2). Admin commands run as ECS
tasks; CloudTrail records who started each one. Decide who may run tasks (an IAM permission), and
whether to use ECS Exec instead so setup links never reach the log.

After this, the Super Admin adds everyone else from the web app's Staff page
(`control-plane.md`, "The first Super Admin").

### 11.2 Checks (15 minutes)

1. `https://cp-staging.<your domain>/v1/health` shows `"status":"ok"` and
   `"database":{"status":"up"...}`.
2. `http://cp-staging.<your domain>/` (plain http) moves to `https://`, with a padlock.
3. `https://cp-staging.<your domain>/` shows the vendor sign-in page. Sign in as the Super Admin.
4. In CloudShell:

   ```bash
   curl -sI https://cp-staging.<your domain>/v1/health | grep -i strict-transport-security
   ```

   prints a `strict-transport-security` line (HSTS).

5. **CloudWatch**, log group `/rp/staging/control-plane`, **Search log group** for
   `"event":"audit"`: your sign-in and the Super Admin's creation are there (manual task 34
   step 5).
6. **RDS**, `rp-staging-cp`, **Connectivity & security**: **Publicly accessible: No**.
7. Restaurant PCs: connect a staging PC (`control-plane.md`, "Connecting a restaurant PC") with
   `RP_CONTROL_PLANE_URL=https://cp-staging.<your domain>`. Its heartbeat appears on the Fleet
   page within 5 minutes. Then the backup check of manual task 26, section 4.

Send back (no keys or passwords): the address, the date, each check passed or failed, and the
licence public key from step 5.3.

## 12. Production

The same steps with `production` in every name, and:

- **Network:** NAT gateway **1 per AZ**.
- **Database:** template **Production** (Multi-AZ), `db.t4g.medium` or larger, 35 days of
  backups, deletion protection on.
- **Secrets and keys:** made fresh by step 5.3 with `ENV=production`. Never copy a staging value.
  Production's licence public key is the one in `vendor-keys.ts` for signed releases.
- **Backups:** bucket `rp-backups-production-...` with its own IAM user and keys.
- **Service:** desired tasks **2** (one in each zone).
- **Address:** `cp.<your domain>`, its own certificate, load balancer and web ACL.
- **Image:** the same image digest that passed on staging. Do not build a new one for production.

**Engineer review: production** as a whole before the first restaurant is connected, with the
penetration test (P8-03e).

## A new version

1. GitHub builds an image on every change to `main`. Copy the new image line from the run's
   summary.
2. **Task definitions**, `rp-staging-control-plane`, select the newest revision, **Create new
   revision**, change only the image. **Create**.
3. Run migrations with the new revision (step 8).
4. **Services**, `control-plane`, **Update service**, the new revision, **Update**. ECS starts the
   new task, waits for it to be healthy, then stops the old one. A failing version is rolled back
   by itself.
5. Staging first; production with the same image once staging is good.

To go back: update the service to the previous revision. That works only while the previous
version understands the database, so only roll back past a release without migrations.

## Saving money on staging

- Scale the service to 0 tasks when nobody is testing (**Update service**, desired tasks 0).
- Stop the database (**Actions**, **Stop temporarily**): AWS starts it again by itself after 7 days.
- The NAT gateway and the load balancer cost money while they exist; delete staging's when it is
  not needed for weeks.

## 13. Monthly costs

Ranges in US dollars for this setup in Mumbai, before tax. They depend on the number of restaurants
and how much they use the service, and AWS changes its prices; check them as below before you
decide. An AWS account in India is billed by Amazon Internet Services Pvt. Ltd. (AISPL) in rupees,
with 18 % GST on top.

| Item                                 | Staging      | Production   | Grows with                                    |
| ------------------------------------ | ------------ | ------------ | --------------------------------------------- |
| Containers (Fargate)                 | $15–30       | $50–120      | tasks running, their CPU and memory           |
| Database (RDS PostgreSQL)            | $15–35       | $100–250     | instance size, Multi-AZ, storage, backups     |
| Load balancer                        | $20–30       | $20–40       | traffic (LCUs)                                |
| NAT gateway(s)                       | $35–50       | $70–110      | one per zone, data passing through            |
| Public IPv4 addresses                | $5–15        | $10–20       | load balancer and NAT addresses               |
| WAF (web ACL, three rules, requests) | $8–12        | $8–20        | requests                                      |
| CloudWatch Logs (180 days)           | $1–10        | $5–40        | log volume: every heartbeat is a request line |
| S3 backup storage                    | $1–5         | $5–60        | restaurants × backup size × kept copies       |
| Secrets Manager, KMS                 | $2–5         | $2–5         | secrets and keys (escrow key, licence key)    |
| ECR, CloudTrail, data out            | $1–10        | $5–20        | images kept, internet traffic                 |
| **Total (roughly)**                  | **$100–200** | **$275–700** |                                               |

Not included: Sentry, WhatsApp messages (per message), the QR relay on Supabase, the domain, and
support plans.

The biggest fixed costs are the NAT gateways, the load balancers and the production database.
Staging costs much less while it is scaled to zero and its database is stopped.

Where to check current prices:

- **AWS Pricing Calculator**, `https://calculator.aws/`: add each item above, region
  **Asia Pacific (Mumbai)**, and save the estimate to share with the engineer.
- Each service's pricing page, region Mumbai: `https://aws.amazon.com/fargate/pricing/`,
  `https://aws.amazon.com/rds/postgresql/pricing/`, `https://aws.amazon.com/elasticloadbalancing/pricing/`,
  `https://aws.amazon.com/vpc/pricing/` (NAT gateway and public IPv4), `https://aws.amazon.com/waf/pricing/`,
  `https://aws.amazon.com/cloudwatch/pricing/`, `https://aws.amazon.com/s3/pricing/`,
  `https://aws.amazon.com/secrets-manager/pricing/`, `https://aws.amazon.com/kms/pricing/`,
  `https://aws.amazon.com/ecr/pricing/`.
- What you actually spend: **Billing and Cost Management**, **Cost Explorer**, grouped by
  service, from the day after you start. Check it after the first week and compare with the
  budget from step 0.1. New accounts may have credits: **Billing**, **Credits**.

## Everything the engineer should review

1. Accounts: one account or separate staging and production accounts (step 0).
2. Network: NAT gateways or another way out for staging (step 1).
3. Database: `rds.force_ssl`, a dedicated login for the service, Multi-AZ and backup copies
   (step 2).
4. Pipeline: `main` protected, the OIDC trust policy (step 3).
5. Logs: nobody but an operator role can delete or shorten them (step 4).
6. Licence key: the KMS key policy, and a KMS signer later (step 5.2).
7. Secrets: rotation of the database password (step 5.3).
8. Access keys for S3 and KMS: rotation, or the container's role instead (step 5.5).
9. Task definition: size, ARM, read-only file system (step 6).
10. Edge rate limits and `check-edge.mjs` (step 9.4).
11. Who may run admin tasks, and ECS Exec (step 11.1).
12. Production as a whole (step 12).
