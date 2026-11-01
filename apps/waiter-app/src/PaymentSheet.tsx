import { ApiRequestError, newIdempotencyKey } from '@rp/api-client';
import type { InvoicePaymentsView } from '@rp/contracts';
import { spacing } from '@rp/design-tokens';
import { formatRupees, grantFor, type Role } from '@rp/domain';
import { messageOf, Note, useDeviceSession, useT } from '@rp/mobile-shell';
import { inputFromPaise, paiseFromInput } from '@rp/ordering';
import { Button, SegmentedControl, Sheet, Text, TextField, useTheme } from '@rp/ui-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

const MODES = ['CASH', 'UPI', 'CARD'] as const;
type Mode = (typeof MODES)[number];

/** Whether this person takes payment (BRD §4.2: owners and managers, BILL-008). */
export function mayTakePayment(person: { readonly role: Role }): boolean {
  return grantFor(person.role, 'BILL_PRINT_AND_PAYMENT') === 'ALLOW';
}

type Due =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'paid' }
  | { readonly status: 'ready'; readonly view: InvoicePaymentsView };

/**
 * Takes payment for a table's printed bill on the phone (P9-16): a manager settles at the table
 * as at the POS, by cash, UPI or card, with the same rules (BILL-008): no more than what is still
 * to pay, cash only with an open shift, one key per payment so a retry never records it twice.
 */
export function PaymentSheet({
  sessionId,
  tableLabel,
  onClose,
  onPaid,
}: {
  sessionId: string;
  tableLabel: string;
  onClose: () => void;
  onPaid: (message: string) => void;
}) {
  const session = useDeviceSession();
  const t = useT();
  const { colors } = useTheme();
  const [due, setDue] = useState<Due>({ status: 'loading' });
  const [mode, setMode] = useState<Mode>('UPI');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  // One key per payment shown here: sending it again is recognised (ORD-013 style).
  const [key] = useState(newIdempotencyKey);

  useEffect(() => {
    // Closed meanwhile: what comes back is not shown.
    const run = { stopped: false };
    void (async () => {
      try {
        const bill = await session.api.openBill({ body: { tableSessionId: sessionId } });
        for (const id of bill.invoiceIds) {
          const view = await session.api.getInvoicePayments({ params: { id } });
          if (view.remaining > 0) {
            if (!run.stopped) {
              setDue({ status: 'ready', view });
              setAmount(inputFromPaise(view.remaining));
            }
            return;
          }
        }
        if (!run.stopped) setDue({ status: 'paid' });
      } catch (failure) {
        if (!run.stopped) setDue({ status: 'error', message: messageOf(failure, t) });
      }
    })();
    return () => {
      run.stopped = true;
    };
  }, [session, sessionId, t]);

  const record = (view: InvoicePaymentsView) => {
    const paise = paiseFromInput(amount);
    if (paise === undefined || paise > view.remaining) {
      setError(t('payment.invalidAmount'));
      return;
    }
    setBusy(true);
    setError(undefined);
    session.api
      .recordPayments({
        params: { id: view.invoiceId },
        body: {
          idempotencyKey: key,
          payments: [
            {
              mode,
              amount: paise,
              tendered: null,
              reference: mode === 'CASH' || reference.trim() === '' ? null : reference.trim(),
              otherModeName: null,
            },
          ],
        },
      })
      .then(
        (result) => {
          setBusy(false);
          onPaid(
            result.remaining === 0
              ? t('payment.settled', { number: result.invoiceNumber })
              : t('payment.recorded', { amount: formatRupees(result.remaining) }),
          );
        },
        (failure: unknown) => {
          setBusy(false);
          setError(
            failure instanceof ApiRequestError && failure.code === 'NO_OPEN_SHIFT'
              ? t('mobile.payment.needShift')
              : t('payment.notRecorded', { message: messageOf(failure, t) }),
          );
        },
      );
  };

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!busy}
      title={t('mobile.payment.title', { table: tableLabel })}
    >
      {due.status === 'loading' ? <Note>{t('states.loading')}</Note> : null}
      {due.status === 'error' ? <Note tone="danger">{due.message}</Note> : null}
      {due.status === 'paid' ? <Note>{t('mobile.payment.nothingDue')}</Note> : null}
      {due.status === 'ready' ? (
        <View style={styles.body}>
          <Text style={{ color: colors.textMuted }}>
            {t('payment.title', { number: due.view.invoiceNumber })}
          </Text>
          <View style={styles.row}>
            <Text>{t('payment.due')}</Text>
            <Text>{formatRupees(due.view.grandTotal)}</Text>
          </View>
          <View style={styles.row}>
            <Text>{t('payment.paid')}</Text>
            <Text>{formatRupees(due.view.paid)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.strong}>{t('payment.remaining')}</Text>
            <Text style={styles.strong}>{formatRupees(due.view.remaining)}</Text>
          </View>
          <SegmentedControl
            label={t('payment.mode')}
            options={MODES.map((id) => ({ id, label: t(`payment.modes.${id}`) }))}
            value={mode}
            onChange={(id) => {
              setMode(id as Mode);
            }}
          />
          <TextField
            label={t('payment.amount')}
            value={amount}
            onChangeText={setAmount}
            // Numbers only (P9-21): the letter keyboard let "AUDITUPI1" into the amount.
            keyboardType="decimal-pad"
          />
          {mode === 'CASH' ? null : (
            <TextField
              label={t('payment.reference')}
              value={reference}
              onChangeText={setReference}
              autoCapitalize="characters"
            />
          )}
          {error === undefined ? null : <Note tone="danger">{error}</Note>}
          <Button
            size="lg"
            fullWidth
            loading={busy}
            testID="record-payment"
            onPress={() => {
              record(due.view);
            }}
          >
            {t('payment.record')}
          </Button>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing[3] },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  strong: { fontWeight: '600' },
});
