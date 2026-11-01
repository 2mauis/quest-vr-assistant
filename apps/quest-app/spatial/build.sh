#!/bin/sh
set -eu
: "${JAVA_HOME:?Set JAVA_HOME to JDK 21}"
: "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK}"
: "${GRADLE_HOME:?Set GRADLE_HOME to Gradle 8.14.3}"
cd "$(dirname "$0")"
export GRADLE_USER_HOME="${QVR_GRADLE_CACHE:-$PWD/build/gradle-home}"
if [ "$#" -eq 0 ]; then set -- :core:test :app:assembleDebug; fi
exec "$GRADLE_HOME/bin/gradle" --no-daemon --console=plain "$@"
