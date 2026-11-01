import java.net.URI

plugins {
    id("com.android.application")
    kotlin("android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val legacy = rootProject.file("../tunnel-probe")
val webUrl = providers.environmentVariable("QVR_WEB_START_URL").orElse("https://app.example.com/")
val generatedJava = layout.buildDirectory.dir("generated/web")
val generateWebConfig = tasks.register("generateWebConfig") {
    inputs.property("webUrl", webUrl)
    outputs.dir(generatedJava)
    doLast {
        val url = URI(webUrl.get())
        // The established website entry uses a non-secret product selector.
        val safeQuery = url.rawQuery == null || url.rawQuery.split('&').all { it.substringBefore('=') == "product" }
        require(url.scheme == "https" && url.host != null && url.userInfo == null &&
            url.port in listOf(-1, 443) && safeQuery && url.rawFragment == null) {
            "QVR_WEB_START_URL must use HTTPS without credentials; only the product query selector is supported"
        }
        val output = generatedJava.get().file("com/example/questvr/tunnelprobe/WebBuildConfig.java").asFile
        output.parentFile.mkdirs()
        output.writeText("package com.example.questvr.tunnelprobe;\nfinal class WebBuildConfig {\n" +
            "static final String START_URL = \"${url.toASCIIString()}\";\n}\n")
    }
}
val generatedAssets = layout.buildDirectory.dir("generated/assets")
val generatePresets = tasks.register<Exec>("generatePresets") {
    inputs.file(rootProject.file("generate-presets.py"))
    outputs.dir(generatedAssets.map { it.dir("presets") })
    commandLine("python3", rootProject.file("generate-presets.py"), generatedAssets.get().dir("presets").asFile)
}
val probeApk = File(legacy, "build/quest-tunnel-probe.apk")
val prepareProbe = tasks.register<Sync>("prepareProbe") {
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
            val existingKey = providers.environmentVariable("QVR_DEBUG_KEYSTORE").orNull
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
        assets.srcDirs(File(legacy, "assets"), generatedAssets, layout.buildDirectory.dir("generated/probe/assets"))
        jniLibs.srcDir(layout.buildDirectory.dir("generated/probe/lib"))
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    packaging {
        jniLibs.useLegacyPackaging = true
        resources.excludes += "META-INF/AL2.0"
        resources.excludes += "META-INF/LGPL2.1"
    }
}
tasks.named("preBuild") { dependsOn(generateWebConfig, generatePresets, prepareProbe) }
dependencies {
    implementation(project(":core"))
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation(platform("androidx.compose:compose-bom:2024.09.03"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    for (module in listOf("", "-vr", "-toolkit", "-compose", "-isdk")) {
        implementation("com.meta.spatial:meta-spatial-sdk${module}:0.14.0")
    }
}
