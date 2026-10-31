// Gradle's and Kotlin's memory for a release build (P9-16): with the template's 512 MB of
// Metaspace, KSP ran out ("OutOfMemoryError: Metaspace") on a first release build on a 16 GB Mac.
// Written into android/gradle.properties at every prebuild, since android/ is generated.
const { withGradleProperties } = require('expo/config-plugins');

const SETTINGS = {
  'org.gradle.jvmargs': '-Xmx4g -XX:MaxMetaspaceSize=1536m -Dfile.encoding=UTF-8',
  'kotlin.daemon.jvmargs': '-Xmx3g -XX:MaxMetaspaceSize=1g',
};

module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (gradle) => {
    for (const [key, value] of Object.entries(SETTINGS)) {
      const existing = gradle.modResults.find(
        (item) => item.type === 'property' && item.key === key,
      );
      if (existing === undefined) gradle.modResults.push({ type: 'property', key, value });
      else existing.value = value;
    }
    return gradle;
  });
};
