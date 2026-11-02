import java.net.URI

plugins {
    id("com.android.application")
    kotlin("android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jlleitschuh.gradle.ktlint")
}

val legacy = rootProject.file("../tunnel-probe")
val webUrl = providers.environmentVariable("QVR_WEB_START_URL").orElse("https://app.example.com/")
val generatedJava = layout.buildDirectory.dir("generated/web")
val generateWebConfig =
    tasks.register("generateWebConfig") {
        inputs.property("webUrl", webUrl)
        outputs.dir(generatedJava)
        doLast {
            val url = URI(webUrl.get())
            // The established website entry uses a non-secret product selector.
            val safeQuery = url.rawQuery == null || url.rawQuery.split('&').all { it.substringBefore('=') == "product" }
            require(
                url.scheme == "https" &&
                    url.host != null &&
                    url.userInfo == null &&
                    url.port in listOf(-1, 443) &&
                    safeQuery &&
                    url.rawFragment == null,
            ) {
                "QVR_WEB_START_URL must use HTTPS without credentials; only the product query selector is supported"
            }
            val output = generatedJava.get().file("com/example/questvr/tunnelprobe/WebBuildConfig.java").asFile
            output.parentFile.mkdirs()
            output.writeText(
                "package com.example.questvr.tunnelprobe;\nfinal class WebBuildConfig {\n" +
                    "static final String START_URL = \"${url.toASCIIString()}\";\n}\n",
            )
        }
    }
val probeApk = File(legacy, "build/quest-tunnel-probe.apk")
// Optional local automation layer; never included in normal / release or CI builds.
val xrOperator = providers.environmentVariable("QVR_XR_OPERATOR_DIR").orNull?.let { file(it) }
val operatorOutput = layout.buildDirectory.dir("generated/xr-operator")
val prepareOperator =
    if (xrOperator != null) {
        tasks.register<Sync>("prepareXrOperator") {
            val library = File(xrOperator, "android/libXrApiLayer_METAX_operator.so")
            val manifest = File(xrOperator, "android/XrApiLayer_METAX_operator.json")
            require(library.isFile && manifest.isFile) { "QVR_XR_OPERATOR_DIR must contain the official Android layer" }
            into(operatorOutput)
            from(library) { into("jni/arm64-v8a") }
            from(manifest) { into("assets/openxr/1/api_layers/implicit.d") }
        }
    } else {
        null
    }
val prepareProbe =
    tasks.register<Sync>("prepareProbe") {
        into(layout.buildDirectory.dir("generated/probe"))
        if (probeApk.exists()) {
            from(zipTree(probeApk)) {
                include("assets/third_party/**", "assets/probe-build.json", "lib/arm64-v8a/libcloudflared_probe.so")
            }
        }
    }

android {
    namespace = "com.example.questvr.tunnelprobe"
    compileSdk = 34
    buildToolsVersion = "35.0.0"
    defaultConfig {
        applicationId = "com.example.questvr.tunnelprobe"
        minSdk = 34
        targetSdk = 34
        versionCode = 4
        versionName = "0.4-spatial"
        ndk { abiFilters += "arm64-v8a" }
    }
    signingConfigs {
        getByName("debug") {
            val existingKey =
                providers
                    .environmentVariable("QVR_DEBUG_KEYSTORE")
                    .orNull
                    ?.let { file(it) } ?: File(legacy, "build/debug.keystore")
            if (existingKey.exists()) {
                storeFile = existingKey
                storePassword = "android"
                keyAlias = "probe"
                keyPassword = "android"
            }
        }
    }
    sourceSets["main"].apply {
        java.srcDirs(File(legacy, "src"), generatedJava)
        assets.srcDirs(File(legacy, "assets"), layout.buildDirectory.dir("generated/probe/assets"))
        jniLibs.srcDir(layout.buildDirectory.dir("generated/probe/lib"))
    }
    if (prepareOperator != null) {
        sourceSets["debug"].apply {
            jniLibs.srcDir(operatorOutput.map { it.dir("jni") })
            assets.srcDir(operatorOutput.map { it.dir("assets") })
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
        allWarningsAsErrors = true
    }
    packaging {
        jniLibs.useLegacyPackaging = true
        resources.excludes += "META-INF/AL2.0"
        resources.excludes += "META-INF/LGPL2.1"
    }
}
tasks.named("preBuild") { dependsOn(generateWebConfig, prepareProbe) }
// The main source set also lists the generated web config directory; lint only after it exists.
tasks.matching { it.name.startsWith("runKtlint") }.configureEach { dependsOn(generateWebConfig) }
if (prepareOperator != null) tasks.matching { it.name == "preDebugBuild" }.configureEach { dependsOn(prepareOperator) }
dependencies {
    implementation(project(":core"))
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation(platform("androidx.compose:compose-bom:2024.09.03"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    for (module in listOf("", "-vr", "-toolkit", "-compose", "-isdk")) {
        implementation("com.meta.spatial:meta-spatial-sdk$module:0.14.0")
    }
}
