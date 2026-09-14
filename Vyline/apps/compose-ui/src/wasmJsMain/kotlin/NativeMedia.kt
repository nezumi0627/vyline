@file:OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class, io.github.composefluent.ExperimentalFluentApi::class)

import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.*
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import kotlinx.browser.document
import kotlinx.browser.window
import org.w3c.dom.HTMLButtonElement
import org.w3c.dom.HTMLImageElement
import org.w3c.dom.HTMLVideoElement
import org.w3c.dom.HTMLElement
import org.w3c.dom.events.KeyboardEvent

@Composable
internal fun NativeMedia(message: ChatMessage, mode: String, onContext: () -> Unit = {}, onView: () -> Unit) {
    val source = message.mediaUrl?.let(::safeMediaUrl).orEmpty()
    if (source.isEmpty()) {
        Label(message.fileName ?: "メディアを読み込めませんでした", 12, color = LocalSecondaryInk.current)
        return
    }
    key(source, message.kind) { when (message.kind) {
        "video" -> ClippedHtmlElementView(
            factory = { (document.createElement("video") as HTMLVideoElement).apply {
                src = source; controls = true; preload = "metadata"; setAttribute("playsinline", "")
                style.width = "100%"; style.height = "100%"; style.borderRadius = "14px"
                setAttribute("aria-label", message.fileName ?: "動画")
                installMediaContextActions(onContext)
            } }, modifier = Modifier.width(280.dp).height(176.dp),
            onRelease = { it.pause(); it.removeAttribute("src"); it.load() })
        "audio" -> NativeAudio(message, source, mode)
        "sticker" -> if (message.stickerAnimated) ClippedHtmlElementView(
            factory = { (document.createElement("button") as HTMLButtonElement).apply {
                type = "button"; setAttribute("aria-label", message.text.ifBlank { "スタンプ" })
                style.width = "100%"; style.height = "100%"; style.padding = "0"; style.border = "0"; style.background = "transparent"
                appendChild((document.createElement("img") as HTMLImageElement).apply {
                    src = source; alt = ""; draggable = false; style.width = "100%"; style.height = "100%"; style.objectFit = "contain"
                })
                addEventListener("click", { onView() })
                installMediaContextActions(onContext)
            } }, modifier = Modifier.size(160.dp)) else {
                var retry by remember(source) { mutableIntStateOf(0) }
                val loaded = rememberRemoteImage(source, 800, retry)
                val bitmap = loaded.bitmap
                Box(Modifier.size(160.dp).combinedClickable(onClick = { if (loaded.failed) retry++ else onView() }, onLongClick = onContext), contentAlignment = Alignment.Center) {
                    if (bitmap != null) Image(bitmap, contentDescription = message.text.ifBlank { "スタンプ" }, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
                    else Label(if (loaded.failed) "スタンプを再読み込み" else "読み込み中…", 12, color = LocalSecondaryInk.current)
                }
            }
        else -> {
            var retry by remember(source) { mutableIntStateOf(0) }
            val loaded = rememberRemoteImage(source, 800, retry)
            val image = loaded.bitmap
            if (image != null) Image(image, contentDescription = message.fileName ?: "画像", contentScale = ContentScale.Fit,
                modifier = Modifier.widthIn(max = 300.dp).width(260.dp).aspectRatio(image.width.toFloat() / image.height.coerceAtLeast(1)).clip(RoundedCornerShape(12.dp))
                    .combinedClickable(onClick = onView, onLongClick = onContext))
            else Box(Modifier.size(width = 230.dp, height = 150.dp).clip(RoundedCornerShape(12.dp)).background(LocalRendererColors.current.surface)
                .combinedClickable(onClick = { if (loaded.failed) retry++ else onView() }, onLongClick = onContext), contentAlignment = Alignment.Center) {
                Label(if (loaded.failed) "画像を再読み込み" else "画像を読み込み中…", 13, color = LocalSecondaryInk.current)
            }
        }
    } }
}

@Composable
internal fun MediaViewer(message: ChatMessage, mode: String, onDismiss: () -> Unit) {
    val previousFocus = remember(message.id) { document.activeElement as? HTMLElement }
    DisposableEffect(message.id) {
        onDispose {
            previousFocus?.let { origin ->
                window.requestAnimationFrame { if (document.contains(origin)) origin.focus() }
            }
        }
    }
    var retry by remember(message.mediaUrl) { mutableIntStateOf(0) }
    val source = remember(message.mediaUrl) { message.mediaUrl?.let(::safeMediaUrl)?.replace(Regex("([?&])preview=1(?=&|#|$)"), "$1preview=0") }
    var zoom by remember(message.id) { mutableFloatStateOf(1f) }
    var pan by remember(message.id) { mutableStateOf(Offset.Zero) }
    val loaded = rememberRemoteImage(if (message.kind == "video" || message.stickerAnimated) null else source, 3200, retry)
    val image = loaded.bitmap
    val focus = rememberNativeModalFocus(if (loaded.failed) listOf("close", "retry") else if (image != null) listOf("close", "image") else listOf("close"), message.id)
    Column(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .96f))
        .onPreviewKeyEvent { if (it.type == KeyEventType.KeyDown && it.key == Key.Escape) { onDismiss(); true } else focus.cycle(it) }) {
        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.End) {
            MediaViewerControlTheme(mode) {
                NativeButton(mode, "閉じる", focus.control("close").heightIn(min = 44.dp), onClick = onDismiss)
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth().clipToBounds().padding(12.dp).pointerInput(message.id, image) {
            detectTransformGestures { _, delta, scale, _ ->
                zoom = (zoom * scale).coerceIn(1f, 4f)
                val bitmap = image
                if (bitmap != null) {
                    val fit = minOf(size.width.toFloat() / bitmap.width, size.height.toFloat() / bitmap.height)
                    val maxX = ((bitmap.width * fit * zoom - size.width) / 2).coerceAtLeast(0f)
                    val maxY = ((bitmap.height * fit * zoom - size.height) / 2).coerceAtLeast(0f)
                    pan = Offset((pan.x + delta.x).coerceIn(-maxX, maxX), (pan.y + delta.y).coerceIn(-maxY, maxY))
                }
            }
        }, contentAlignment = Alignment.Center) {
            if (message.kind == "video" && !source.isNullOrEmpty()) key(source) {
                ClippedHtmlElementView(
                    factory = { (document.createElement("video") as HTMLVideoElement).apply {
                        src = source; controls = true; preload = "metadata"; setAttribute("playsinline", "")
                        setAttribute("aria-label", message.fileName ?: "動画")
                        style.width = "100%"; style.height = "100%"; style.objectFit = "contain"
                    } }, modifier = Modifier.fillMaxSize(),
                    onRelease = { it.pause(); it.removeAttribute("src"); it.load() })
            }
            else if (message.stickerAnimated && !source.isNullOrEmpty()) ClippedHtmlElementView(
                factory = { (document.createElement("img") as HTMLImageElement).apply {
                    src = source; alt = message.text.ifBlank { "スタンプ" }; draggable = false
                    style.width = "100%"; style.height = "100%"; style.objectFit = "contain"
                } }, modifier = Modifier.fillMaxSize())
            else if (image != null) Image(image, contentDescription = message.fileName ?: "画像", modifier = Modifier.fillMaxSize().then(focus.control("image"))
                .semantics { stateDescription = "${(zoom * 100).toInt()}%" }
                .combinedClickable(onClick = { zoom = if (zoom > 1f) 1f else 2f; pan = Offset.Zero })
                .graphicsLayer { scaleX = zoom; scaleY = zoom; translationX = pan.x; translationY = pan.y }, contentScale = ContentScale.Fit)
            else if (loaded.failed) Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Label("画像を読み込めませんでした", 14, color = Color.White)
                MediaViewerControlTheme(mode) {
                    NativeButton(mode, "再試行", focus.control("retry").heightIn(min = 44.dp)) { retry++ }
                }
            } else Label("画像を読み込み中…", 14, color = Color.White)
        }
    }
}

/** Theme controls only: no root Mica/Scaffold and no theme key around the live media subtree. */
@Composable
private fun MediaViewerControlTheme(mode: String, content: @Composable () -> Unit) {
    // The viewer is always a black overlay, independent of the app's appearance.
    val overlay = LocalRendererColors.current.copy(
        text = Color.White, secondary = Color.White.copy(alpha = .72f),
        disabled = Color.White.copy(alpha = .4f), accent = Color.White, accentText = Color.White, onAccent = Color.Black,
    )
    CompositionLocalProvider(LocalRendererColors provides overlay, LocalInk provides overlay.text,
        LocalSecondaryInk provides overlay.secondary, LocalAccent provides overlay.accent) {
        when (mode) {
            "fluent" -> io.github.composefluent.FluentTheme(colors = io.github.composefluent.darkColors(), content = content)
            "miuix" -> top.yukonga.miuix.kmp.theme.MiuixTheme(colors = top.yukonga.miuix.kmp.theme.darkColorScheme(), content = content)
            else -> content()
        }
    }
}

private fun HTMLElement.installMediaContextActions(onContext: () -> Unit) {
    addEventListener("contextmenu", { event -> event.preventDefault(); onContext() })
    addEventListener("keydown", { event ->
        val key = event as KeyboardEvent
        if (key.key == "ContextMenu" || key.key == "F10" && key.shiftKey) { event.preventDefault(); onContext() }
    })
}
