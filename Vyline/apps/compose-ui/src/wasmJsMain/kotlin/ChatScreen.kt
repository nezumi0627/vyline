@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class, androidx.compose.ui.ExperimentalComposeUiApi::class, io.github.composefluent.ExperimentalFluentApi::class, kotlin.js.ExperimentalWasmJsInterop::class)

import androidx.compose.ui.layout.ContentScale

import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.onPointerEvent
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.shadow.Shadow
import com.kyant.shapes.RoundedRectangle
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import io.github.composefluent.component.AccentButton
import io.github.composefluent.component.Button as FluentButton
import io.github.composefluent.component.TextField as FluentTextField
import io.github.composefluent.icons.Icons
import io.github.composefluent.icons.regular.*
import top.yukonga.miuix.kmp.basic.Button as MiuixButton
import top.yukonga.miuix.kmp.basic.TextField as MiuixTextField
import top.yukonga.miuix.kmp.basic.SmallTopAppBar
import top.yukonga.miuix.kmp.blur.layerBackdrop as miuixLayerBackdrop

@Composable
fun ChatScreen(state: SidebarSnapshot, split: Boolean) {
    val action = rememberScopedAction()
    val chat = state.chat ?: return
    val backdrop = rememberLayerBackdrop()
    val miuixChrome = if (state.mode == "miuix") rememberMiuixChrome() else null
    val density = LocalDensity.current
    val timeline = rememberLazyListState()
    var headerHeight by remember { mutableStateOf(if (state.mode == "apple") 90.dp else 64.dp) }
    var composerHeight by remember { mutableStateOf(94.dp) }
    var toolsVisible by remember(chat.id) { mutableStateOf(false) }
    var toolsMounted by remember(chat.id) { mutableStateOf(false) }
    var toolsAnchor by remember(chat.id) { mutableStateOf<Rect?>(null) }
    val messageBounds = remember(chat.id) { mutableMapOf<String, Rect>() }
    var screenOrigin by remember { mutableStateOf(Offset.Zero) }
    var mediaMessageId by remember { mutableStateOf<String?>(null) }
    val mediaMessage = remember(state.messages, mediaMessageId) { mediaMessageId?.let { id ->
        state.messages.find { it.id == id && !it.messageState.startsWith("revoked") }
    } }
    LaunchedEffect(mediaMessageId, mediaMessage) {
        if (mediaMessage == null) mediaMessageId = null
    }
    val detailsVisible = state.mode == "apple" && state.profileOpen
    val surface = LocalRendererColors.current.canvas
    CompositionLocalProvider(LocalMiuixChrome provides miuixChrome) {
    BoxWithConstraints(Modifier.fillMaxSize().onGloballyPositioned { screenOrigin = it.positionInWindow() }) {
        val inlineDetails = maxWidth >= 740.dp
        val availableHeight = maxHeight
        val insetAppleTimeline = state.mode == "apple" && !split
        val timelineTopInset = if (insetAppleTimeline) headerHeight else 0.dp
        val timelineHeight = if (availableHeight > timelineTopInset) availableHeight - timelineTopInset else 0.dp
        Row(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxHeight().background(surface)) {
        MessageTimeline(state, backdrop, timeline, timelineHeight,
            if (insetAppleTimeline) 0.dp else headerHeight, composerHeight, messageBounds,
            modifier = Modifier.padding(top = timelineTopInset),
            htmlVisible = state.nativePanel == null && (state.controllerCall == null || state.controllerCall.callLayout in listOf("minimized", "docked")) && !toolsMounted && mediaMessage == null && state.readersPanel == null && state.hostMenu == null && state.controllerDialog == null && (!detailsVisible || inlineDetails),
            onMenu = { message ->
                val bounds = messageBounds[message.id]
                action("message-menu", id = message.id, value = bounds?.let { (it.width / density.density).toString() },
                    x = (bounds?.left ?: screenOrigin.x) / density.density,
                    y = (bounds?.center?.y ?: screenOrigin.y) / density.density)
            }, onMedia = { mediaMessageId = it.id })
        Column(Modifier.fillMaxWidth()
            .onSizeChanged { headerHeight = with(density) { it.height.toDp() } }) {
        ChatHeader(state, split, backdrop, Modifier.fillMaxWidth()) {
            if (state.mode == "apple") {
                action(if (detailsVisible) "close-details" else "chat-details")
            } else action("profile", id = chat.id)
        }
        ChatAuxiliary(state, backdrop)
        }
        NativeComposer(state, backdrop, compact = !split, modifier = Modifier.align(Alignment.BottomCenter).widthIn(max = when (state.mode) { "apple" -> 1200.dp; "fluent" -> 1100.dp; else -> 920.dp }).fillMaxWidth()
            .onSizeChanged { composerHeight = with(density) { it.height.toDp() } },
            onToolsBoundsChanged = { toolsAnchor = it },
            onOpenTools = { toolsMounted = true; toolsVisible = true })
        if (state.notice.isNotBlank()) Box(Modifier.align(Alignment.TopCenter).padding(top = headerHeight + 8.dp)
            .clip(RoundedCornerShape(12.dp)).background(LocalInk.current.copy(alpha = .90f)).padding(horizontal = 18.dp, vertical = 12.dp)
            .semantics { liveRegion = LiveRegionMode.Polite }) { Label(state.notice, 13, color = surface, maxLines = 3) }
        mediaMessage?.let { message -> MediaViewer(message, state.mode, onDismiss = { mediaMessageId = null }) }        }
        if (detailsVisible && inlineDetails) Box(Modifier.width(320.dp).fillMaxHeight()) { AppleDetails(state, backdrop) { action("close-details") } }
        }
        if (detailsVisible && !inlineDetails) AppleDetails(state, backdrop) { action("close-details") }
        if (state.readersPanel != null) NativeReadersPanel(state, backdrop) { action("close-readers") }
        if (toolsMounted) {
            val anchor = toolsAnchor?.translate(-screenOrigin)
            val menu = HostMenu("composer-tools", anchor?.let { (it.left / density.density).toDouble() } ?: 12.0,
                anchor?.let { (it.top / density.density).toDouble() } ?: (maxHeight - composerHeight).value.toDouble(), listOf(
                HostMenuItem("photo", "写真・動画"), HostMenuItem("attach", "ファイル"),
                HostMenuItem("sticker-picker", "スタンプと絵文字"),
                HostMenuItem("chat-tools", "ノート・アルバム・イベント"),
                HostMenuItem("record-start", "音声メッセージを録音"),
                HostMenuItem("mute", if (state.composer.mute) "通知して送信" else "通知せず送信"),
                HostMenuItem("chat-search", "トーク内を検索"), HostMenuItem("chat-menu", "トークの操作"), HostMenuItem("settings", "設定")))
            val choose: (String) -> Unit = { id ->
                    toolsVisible = false
                    when (id) {
                        "photo" -> action("attach", value = "media")
                        "mute" -> action("mute", value = (!state.composer.mute).toString())
                        "chat-menu" -> action(id, x = (toolsAnchor?.center?.x ?: 0f) / density.density, y = (toolsAnchor?.top ?: 0f) / density.density)
                        else -> action(id)
                    }
                }
            if (state.mode == "apple") AppleComposerMenu(state, menu.items, backdrop, toolsVisible,
                anchor = toolsAnchor?.translate(-screenOrigin),
                onDismiss = { toolsVisible = false }, onDismissFinished = { toolsMounted = false }, onChoose = choose)
            else ThemedHostMenu(menu, state.mode, state.dark, backdrop, toolsVisible,
                onDismissFinished = { toolsMounted = false }, onDismissRequest = { toolsVisible = false }, onChoose = choose)
        }
    }
    }
}

@Composable
private fun ChatHeader(state: SidebarSnapshot, split: Boolean, backdrop: Backdrop, modifier: Modifier, onDetails: () -> Unit) {
    val action = rememberScopedAction()
    val chat = state.chat ?: return
    val surface = LocalRendererColors.current.raised
    val avatar = ConversationRow(chat.id, chat.title, avatar = chat.avatar, color = chat.color, avatarUrl = chat.avatarUrl)
    when (state.mode) {
        "apple" -> BoxWithConstraints(modifier.height(122.dp)) {
            Box(Modifier.matchParentSize().graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
                .drawWithContent {
                    drawContent()
                    drawRect(Brush.verticalGradient(listOf(Color.Black, Color.Black.copy(alpha = .9f), Color.Transparent)), blendMode = BlendMode.DstIn)
                }
                .drawBackdrop(backdrop, { RoundedRectangle(0.dp) }, effects = { vibrancy(); blur(14.dp.toPx()) },
                    highlight = null, shadow = null,
                    onDrawSurface = { drawRect((if (state.dark) Color.Black else Color.White).copy(alpha = .15f)) }))
            val titleWidth = (maxWidth - 96.dp).coerceAtMost(360.dp)
            val nameMotion = rememberAppleLiquidMotion(enabled = true, reducedMotion = state.reducedMotion)
            if (!split) AppleGlassIcon(backdrop, AppleSymbol.Back, "トーク一覧に戻る", Modifier.align(Alignment.TopStart).padding(start = 12.dp, top = 12.dp), dark = state.dark) { action("back") }
            else AppleGlassIcon(backdrop, AppleSymbol.Sidebar, if (state.sidebarCollapsed) "サイドバーを開く" else "サイドバーを閉じる", Modifier.align(Alignment.TopStart).padding(start = 12.dp, top = 12.dp), dark = state.dark) { action("sidebar-toggle") }
            Column(Modifier.align(Alignment.TopCenter).padding(top = 10.dp).widthIn(max = titleWidth)
                .clickable(interactionSource = nameMotion.interactionSource, indication = null, role = Role.Button, onClick = onDetails)
                .semantics { contentDescription = "${chat.title}の情報" }, horizontalAlignment = Alignment.CenterHorizontally) {
                Avatar(avatar, 60, gradient = true)
                Spacer(Modifier.height(2.dp))
                Row(Modifier.widthIn(max = titleWidth)
                    .appleLiquidBackdrop(nameMotion, backdrop, { CircleShape }, surface.copy(alpha = .90f), blurRadius = 9.dp, lensRadius = 7.dp, lensHeight = 14.dp)
                    .then(nameMotion.pointerModifier).padding(horizontal = 12.dp, vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    Label(chat.title, 16, FontWeight.Bold, modifier = Modifier.weight(1f, fill = false))
                    AppleGlyph(AppleSymbol.ChevronRight, LocalSecondaryInk.current.copy(alpha = .65f), 18)
                }
            }
            AppleGlassIcon(backdrop, AppleSymbol.Video, "ビデオ通話", Modifier.align(Alignment.TopEnd).padding(end = 16.dp, top = 12.dp), enabled = chat.canVideoCall, dark = state.dark) { action("call", id = chat.id, value = "video") }
        }
        "miuix" -> BoxWithConstraints(modifier) {
            val compactHeader = maxWidth < 420.dp
            SmallTopAppBar(title = chat.title,
            modifier = Modifier.fillMaxWidth().miuixChrome(RoundedRectangle(0.dp), state.dark), color = Color.Transparent,
            titlePadding = if (compactHeader) 6.dp else top.yukonga.miuix.kmp.basic.TopAppBarDefaults.TitlePadding,
            navigationIconPadding = if (compactHeader) 8.dp else top.yukonga.miuix.kmp.basic.TopAppBarDefaults.NavigationIconPadding,
            actionIconPadding = if (compactHeader) 8.dp else top.yukonga.miuix.kmp.basic.TopAppBarDefaults.ActionIconPadding,
            navigationIcon = { Row(verticalAlignment = Alignment.CenterVertically) {
                if (!split) Command(state.mode, Icons.Regular.ChevronLeft, "トーク一覧に戻る", "back")
                else Command(state.mode, Icons.Regular.MoreHorizontal, if (state.sidebarCollapsed) "サイドバーを開く" else "サイドバーを閉じる", "sidebar-toggle")
                Box(Modifier.combinedClickable(onClick = { action("profile", id = chat.id) }).semantics { contentDescription = "${chat.title}の情報" }) { Avatar(avatar, 30) }
            } },
            actions = { Row {
                if (!compactHeader) Command(state.mode, Icons.Regular.Search, "トーク内を検索", "chat-search")
                Command(state.mode, Icons.Regular.MoreHorizontal, "トークの操作", "chat-menu")
                Command(state.mode, Icons.Regular.Settings, "設定", "settings")
            } }, defaultWindowInsetsPadding = false)
        }
        else -> BoxWithConstraints(modifier) {
            val compactHeader = maxWidth < 420.dp
            Row(Modifier.fillMaxWidth().background(surface).padding(horizontal = if (compactHeader) 8.dp else 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(if (compactHeader) 6.dp else 12.dp)) {
            if (!split) Command(state.mode, Icons.Regular.ArrowLeft, "トーク一覧に戻る", "back")
            else Command(state.mode, Icons.Regular.MoreHorizontal, if (state.sidebarCollapsed) "サイドバーを開く" else "サイドバーを閉じる", "sidebar-toggle")
            Box(Modifier.combinedClickable(role = Role.Button, onClick = { action("profile", id = chat.id) }).semantics { contentDescription = "${chat.title}のプロフィール" }) { Avatar(avatar, if (compactHeader) 32 else 38) }
            Column(Modifier.weight(1f).combinedClickable(onClick = { action("profile", id = chat.id) }).semantics { contentDescription = "${chat.title}の情報" }, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Label(chat.title, 18, FontWeight.SemiBold)
                if (chat.status.isNotBlank()) Label(chat.status, 11, color = LocalSecondaryInk.current)
            }
            // Search remains available in the composer menu at every width.
            if (!compactHeader) Command(state.mode, Icons.Regular.Search, "トーク内を検索", "chat-search")
            Command(state.mode, Icons.Regular.MoreHorizontal, "トークの操作", "chat-menu")
            Command(state.mode, Icons.Regular.Settings, "設定", "settings")
            }
        }
    }
}

private enum class TimelineOwnership { Bottom, History, Target }

private data class TimelineAnchor(
    val generation: Int,
    val positions: List<Pair<String, Int>>,
    val beforePadding: Int,
    val firstMessage: String? = null,
    val bubbleTop: Float? = null,
)

/** One instance per mounted pane/account/chat. Only new intents advance generation. */
private class TimelineCoordinator {
    var generation by mutableIntStateOf(0)
        private set
    var ownership by mutableStateOf(TimelineOwnership.Bottom)
        private set
    var target by mutableStateOf<String?>(null)
        private set
    var resizeAnchor by mutableStateOf<TimelineAnchor?>(null)
    var historyAnchor by mutableStateOf<TimelineAnchor?>(null)
    var historyWasLoading = false
    var targetApplied = -1
    var correction: Job? = null
    var userScrollAt = Double.NEGATIVE_INFINITY
    var userPosition: Pair<Int, Int>? = null
    var userScrolling = false

    fun intent(owner: TimelineOwnership, id: String? = null) {
        correction?.cancel()
        generation++
        ownership = owner
        target = id
        resizeAnchor = null
        historyAnchor = null
        userScrollAt = Double.NEGATIVE_INFINITY
        userPosition = null
        userScrolling = false
    }

    fun userInput(list: LazyListState) {
        val startedAt = userPosition ?: (list.firstVisibleItemIndex to list.firstVisibleItemScrollOffset)
        val wasScrolling = userScrolling || list.isScrollInProgress
        intent(TimelineOwnership.History)
        userScrollAt = messageInteractionNow()
        userPosition = startedAt
        userScrolling = wasScrolling
    }
}

private data class TimelineLayout(val before: Int, val after: Int, val height: Int) {
    fun matches(geometry: TimelineGeometry): Boolean =
        geometry.before == before && geometry.after == after && geometry.end - geometry.start == height
}

private data class TimelineWork(
    val generation: Int,
    val geometry: TimelineGeometry,
    val layout: TimelineLayout,
    val firstMessage: String?,
    val lastMessage: String?,
    val messageCount: Int,
    val hasMore: Boolean,
    val loading: Boolean,
    val resizeAnchor: TimelineAnchor?,
    val historyAnchor: TimelineAnchor?,
    val targetIndex: Int,
)

private data class TimelineGeometry(
    val total: Int,
    val before: Int,
    val after: Int,
    val start: Int,
    val end: Int,
    val width: Int,
    val firstIndex: Int,
    val firstOffset: Int,
    val forward: Boolean,
    val rows: List<Triple<Any, Int, Int>>,
)

private fun LazyListState.timelineGeometry(): TimelineGeometry = layoutInfo.let { info ->
    TimelineGeometry(info.totalItemsCount, info.beforeContentPadding, info.afterContentPadding,
        info.viewportStartOffset, info.viewportEndOffset, info.viewportSize.width,
        firstVisibleItemIndex, firstVisibleItemScrollOffset, canScrollForward,
        info.visibleItemsInfo.map { Triple(it.key, it.offset, it.size) })
}

private fun LazyListState.atTimelineEnd(lastKey: String?): Boolean {
    if (lastKey == null || canScrollForward) return false
    val info = layoutInfo
    val last = info.visibleItemsInfo.lastOrNull() ?: return false
    return last.key == lastKey && last.index == info.totalItemsCount - 1 &&
        last.offset + last.size + info.afterContentPadding <= info.viewportEndOffset
}

private fun LazyListState.captureTimelineAnchor(generation: Int): TimelineAnchor = layoutInfo.let { info ->
    TimelineAnchor(generation, info.visibleItemsInfo.mapNotNull { row ->
        (row.key as? String)?.let { it to row.offset + info.beforeContentPadding }
    }, info.beforeContentPadding)
}

/** Materialize, then measure: aligning a tall final row's start is not reaching its end. */
private suspend fun settleTimelineEnd(list: LazyListState, coordinator: TimelineCoordinator,
    generation: Int, onMeasured: (TimelineGeometry) -> Unit, lastKey: () -> String?) {
    repeat(6) {
        withFrameNanos {} // Await layout, not a time-based guess about media readiness.
        if (coordinator.generation != generation || coordinator.ownership != TimelineOwnership.Bottom) return
        onMeasured(list.timelineGeometry())
        val key = lastKey() ?: return // Bottom intent survives an empty/loading timeline.
        val info = list.layoutInfo
        if (info.totalItemsCount == 0 || info.viewportSize.height == 0) return
        if (list.atTimelineEnd(key)) return
        val before = list.timelineGeometry()
        val last = info.visibleItemsInfo.lastOrNull { it.key == key && it.index == info.totalItemsCount - 1 }
        if (last == null) list.scrollToItem(info.totalItemsCount - 1)
        else {
            val delta = last.offset + last.size + info.afterContentPadding - info.viewportEndOffset
            if (delta <= 0) return
            val consumed = list.scrollBy(delta.toFloat())
            if (consumed == 0f) return
        }
        withFrameNanos {}
        val after = list.timelineGeometry()
        onMeasured(after)
        if (coordinator.generation != generation || after == before) return
    }
}

@Composable
private fun MessageTimeline(state: SidebarSnapshot,
    backdrop: com.kyant.backdrop.backdrops.LayerBackdrop, list: LazyListState, viewportHeight: androidx.compose.ui.unit.Dp, top: androidx.compose.ui.unit.Dp, bottom: androidx.compose.ui.unit.Dp, messageBounds: MutableMap<String, Rect>, modifier: Modifier = Modifier, htmlVisible: Boolean, onMenu: (ChatMessage) -> Unit, onMedia: (ChatMessage) -> Unit) {
    val action = rememberScopedAction()
    val messages = state.messages
    val mode = state.mode
    val dark = state.dark
    val settings = state.settings
    val history = state.history
    val chat = state.chat ?: return
    val group = chat.isGroup
    val miuixChrome = LocalMiuixChrome.current
    val scrolling = list.isScrollInProgress
    SideEffect { miuixChrome?.scrolling = scrolling }
    DisposableEffect(miuixChrome) { onDispose { miuixChrome?.scrolling = false } }
    val coordinator = remember(state.epoch, chat.id) { TimelineCoordinator() }
    ObserveTimeline(state, list, ownership = { coordinator.ownership.name.lowercase() }) { coordinator.generation }
    var olderBoundaryArmed by remember(coordinator) { mutableStateOf(false) }
    val currentHistory by rememberUpdatedState(history)
    val currentMessages by rememberUpdatedState(messages)
    fun requestOlder() {
        coordinator.intent(TimelineOwnership.History)
        val anchor = list.captureTimelineAnchor(coordinator.generation)
        coordinator.historyAnchor = anchor.copy(firstMessage = currentMessages.firstOrNull()?.id,
            bubbleTop = anchor.positions.firstOrNull()?.first?.let { messageBounds[it]?.top })
        coordinator.historyWasLoading = false
        action("load-older")
    }
    // Publish the convenience button only from settled geometry. Intermediate
    // disclosure padding must not create another resize (or its own 48px threshold).
    val bottomThreshold by rememberUpdatedState(with(LocalDensity.current) { 80.dp.toPx() })
    val baseBottomPadding by rememberUpdatedState(with(LocalDensity.current) { (bottom + 14.dp).roundToPx() })
    var showJump by remember(coordinator) { mutableStateOf(false) }
    val jumpHeight = if (showJump) 48.dp else 0.dp
    val searchTarget = state.chatUi?.search?.activeId
    var seenLatest by remember(coordinator) { mutableIntStateOf(-1) }
    var seenHighlight by remember(coordinator) { mutableStateOf<String?>(null) }
    var seenSearch by remember(coordinator) { mutableStateOf<String?>(null) }
    SideEffect {
        if (seenLatest != state.scrollLatest) {
            seenLatest = state.scrollLatest
            if (state.scrollLatest > 0) coordinator.intent(TimelineOwnership.Bottom)
        }
        if (seenHighlight != state.highlightMessageId) {
            if (state.highlightMessageId != null) coordinator.intent(TimelineOwnership.Target, state.highlightMessageId)
            else if (coordinator.ownership == TimelineOwnership.Target && coordinator.target == seenHighlight)
                coordinator.intent(TimelineOwnership.History)
            seenHighlight = state.highlightMessageId
        }
        if (seenSearch != searchTarget) {
            if (searchTarget != null) coordinator.intent(TimelineOwnership.Target, searchTarget)
            else if (coordinator.ownership == TimelineOwnership.Target && coordinator.target == seenSearch)
                coordinator.intent(TimelineOwnership.History)
            seenSearch = searchTarget
        }
    }
    val density = LocalDensity.current.density
    val requestedLayout = with(LocalDensity.current) {
        TimelineLayout((top + 16.dp).roundToPx(), (bottom + jumpHeight + 14.dp).roundToPx(), viewportHeight.roundToPx())
    }
    val currentLayout by rememberUpdatedState(requestedLayout)
    // Capture pre-layout stable keys, including screen-relative leading padding.
    // Keep the original goal if more chrome measurements arrive before it settles.
    val layoutAnchor = remember(coordinator, requestedLayout) {
        list.captureTimelineAnchor(coordinator.generation)
    }
    var publishedLayoutAnchor by remember(coordinator) { mutableStateOf<TimelineAnchor?>(null, referentialEqualityPolicy()) }
    SideEffect {
        if (publishedLayoutAnchor !== layoutAnchor) {
            publishedLayoutAnchor = layoutAnchor
            if (layoutAnchor.generation == coordinator.generation && coordinator.ownership != TimelineOwnership.Bottom &&
                coordinator.resizeAnchor == null)
                coordinator.resizeAnchor = layoutAnchor
        }
    }
    var timelineBounds by remember { mutableStateOf(Rect.Zero) }
    val htmlViewport = scrollingHtmlViewport(Rect(timelineBounds.left, timelineBounds.top + top.value,
        timelineBounds.right, timelineBounds.bottom - bottom.value - jumpHeight.value), htmlVisible, list) { coordinator.userInput(list) }

    LaunchedEffect(list, coordinator) {
        // Position changes alone do not imply user input (resize and our corrections
        // also scroll). Only a real input followed by movement can return ownership.
        snapshotFlow { Triple(list.firstVisibleItemIndex, list.firstVisibleItemScrollOffset, list.isScrollInProgress) }
            .collect { (index, offset, scrollingNow) ->
                val userPosition = coordinator.userPosition
                if (userPosition != null && scrollingNow) coordinator.userScrolling = true
                if (!scrollingNow && userPosition != null && (coordinator.userScrolling || userPosition != (index to offset))) {
                    if (userPosition != (index to offset) && coordinator.ownership == TimelineOwnership.History &&
                        list.atTimelineEnd(currentMessages.lastOrNull()?.id)) coordinator.intent(TimelineOwnership.Bottom)
                    // A later resize must not complete a previously finished gesture.
                    coordinator.userPosition = null
                    coordinator.userScrolling = false
                }
                if (index > 1 || offset > 240) olderBoundaryArmed = true
                else if (index == 0 && offset <= 80 && olderBoundaryArmed &&
                    messageInteractionNow() - coordinator.userScrollAt < 1500 && currentHistory.hasMore && !currentHistory.loading) {
                    olderBoundaryArmed = false
                    requestOlder()
                }
            }
    }
    LaunchedEffect(list, coordinator) {
        fun updateJumpVisibility() {
            val geometry = list.timelineGeometry()
            if (!currentLayout.matches(geometry) || coordinator.resizeAnchor != null || coordinator.historyAnchor != null) return
            val last = list.layoutInfo.visibleItemsInfo.lastOrNull()
            showJump = list.canScrollForward && (last == null || last.index != list.layoutInfo.totalItemsCount - 1 ||
                last.offset + last.size + baseBottomPadding - list.layoutInfo.viewportEndOffset > bottomThreshold)
        }
        fun workSnapshot(): TimelineWork = TimelineWork(coordinator.generation, list.timelineGeometry(), currentLayout,
            currentMessages.firstOrNull()?.id, currentMessages.lastOrNull()?.id, currentMessages.size,
            currentHistory.hasMore, currentHistory.loading, coordinator.resizeAnchor, coordinator.historyAnchor,
            if (coordinator.ownership == TimelineOwnership.Target && coordinator.targetApplied != coordinator.generation)
                currentMessages.indexOfFirst { it.id == coordinator.target } else -1)
        var settledSnapshot: TimelineWork? = null
        snapshotFlow { workSnapshot() }.collect { observed ->
            if (observed == settledSnapshot) return@collect
            val generation = coordinator.generation
            if (coordinator.ownership == TimelineOwnership.History &&
                observed.resizeAnchor == null && observed.historyAnchor == null) {
                updateJumpVisibility()
                settledSnapshot = observed
                return@collect
            }
            // Child cancellation stops an old correction, not this geometry observer.
            var bottomMeasurement: TimelineGeometry? = null
            var resizeMeasurement: TimelineGeometry? = null
            val correction = launch {
                withFrameNanos {}
                if (generation != coordinator.generation) return@launch
                if (coordinator.ownership == TimelineOwnership.Bottom) {
                    settleTimelineEnd(list, coordinator, generation, { bottomMeasurement = it }) { currentMessages.lastOrNull()?.id }
                    return@launch
                }
                val target = coordinator.target
                if (coordinator.ownership == TimelineOwnership.Target && coordinator.targetApplied != generation) {
                    val index = currentMessages.indexOfFirst { it.id == target }
                    if (index < 0) return@launch // Retain an explicit target until its data arrives.
                    coordinator.resizeAnchor = null
                    list.scrollToItem(index + if (currentHistory.hasMore || currentHistory.loading) 1 else 0)
                    if (generation == coordinator.generation) coordinator.targetApplied = generation
                    return@launch
                }
                val historyAnchor = coordinator.historyAnchor
                if (historyAnchor != null && historyAnchor.generation == generation) {
                    if (currentMessages.firstOrNull()?.id != historyAnchor.firstMessage) {
                        val position = historyAnchor.positions.firstOrNull()
                        val index = currentMessages.indexOfFirst { it.id == position?.first }
                        coordinator.historyAnchor = null
                        // Prepend and resize share the captured anchor; never apply both.
                        coordinator.resizeAnchor = null
                        if (position != null && index >= 0) {
                            list.scrollToItem(index + if (currentHistory.hasMore || currentHistory.loading) 1 else 0,
                                list.layoutInfo.beforeContentPadding - position.second)
                            withFrameNanos {}; withFrameNanos {}
                            if (generation != coordinator.generation) return@launch
                            val currentTop = messageBounds[position.first]?.top
                            if (currentTop != null && historyAnchor.bubbleTop != null)
                                list.scrollBy(currentTop - historyAnchor.bubbleTop)
                        }
                        return@launch
                    }
                    if (currentHistory.loading) coordinator.historyWasLoading = true
                    else if (coordinator.historyWasLoading) coordinator.historyAnchor = null
                }
                val anchor = coordinator.resizeAnchor
                if (anchor != null && anchor.generation == generation) {
                    // A frame callback precedes layout; it is not evidence that the
                    // requested padding has been measured. Retain the goal until it has.
                    val geometry = list.timelineGeometry()
                    resizeMeasurement = geometry
                    if (!currentLayout.matches(geometry)) return@launch
                    val displacement = anchor.positions.firstNotNullOfOrNull { (key, position) ->
                        geometry.rows.find { it.first == key }?.let { it.second + geometry.before - position }
                    } ?: (geometry.before - anchor.beforePadding)
                    if (displacement != 0) list.scrollBy(displacement.toFloat())
                    val after = list.timelineGeometry()
                    resizeMeasurement = after
                    if (generation != coordinator.generation || !currentLayout.matches(after)) return@launch
                    // scrollBy remeasures synchronously. Consume this goal only after
                    // that measured correction, or a genuine list boundary, not on a timer.
                    val remaining = anchor.positions.firstNotNullOfOrNull { (key, position) ->
                        after.rows.find { it.first == key }?.let { it.second + after.before - position }
                    } ?: (after.before - anchor.beforePadding)
                    if (remaining == 0 ||
                        (remaining > 0 && !list.canScrollForward) || (remaining < 0 && !list.canScrollBackward)) {
                        if (coordinator.resizeAnchor === anchor) coordinator.resizeAnchor = null
                    } else {
                        // Do not absorb an unfinished correction as settled. A changed
                        // measurement gets another pass; unchanged geometry stays idle.
                        resizeMeasurement = geometry
                    }
                }
            }
            coordinator.correction = correction
            correction.join()
            if (coordinator.correction === correction) coordinator.correction = null
            // Absorb our own measured offset/padding changes, rather than creating a
            // new settlement per correction frame. Later media/viewport changes emit anew.
            if (generation == coordinator.generation) {
                updateJumpVisibility()
                val finished = workSnapshot()
                settledSnapshot = observed.copy(geometry = bottomMeasurement ?: resizeMeasurement ?: finished.geometry,
                    resizeAnchor = if (finished.resizeAnchor === observed.resizeAnchor) finished.resizeAnchor else null,
                    historyAnchor = if (finished.historyAnchor === observed.historyAnchor) finished.historyAnchor else null,
                    targetIndex = if (coordinator.targetApplied == generation) -1 else observed.targetIndex)
            }
        }
    }
    CompositionLocalProvider(LocalHtmlViewport provides htmlViewport) {
    Box(modifier.fillMaxSize()) {
    LazyColumn(state = list, modifier = Modifier.fillMaxSize().then(when {
        mode == "apple" -> Modifier.layerBackdrop(backdrop)
        miuixChrome != null -> Modifier.miuixLayerBackdrop(miuixChrome.backdrop)
        else -> Modifier
    })
        .onPointerEvent(PointerEventType.Scroll, androidx.compose.ui.input.pointer.PointerEventPass.Initial) { coordinator.userInput(list) }
        .onPointerEvent(PointerEventType.Move, androidx.compose.ui.input.pointer.PointerEventPass.Initial) { event -> if (event.changes.any { it.type == PointerType.Touch && it.pressed && it.position.y != it.previousPosition.y }) coordinator.userInput(list) }
        .onGloballyPositioned { val bounds = it.boundsInWindow(); timelineBounds = Rect(bounds.left / density, bounds.top / density, bounds.right / density, bounds.bottom / density) }
        .semantics { contentDescription = "メッセージ履歴" },
        contentPadding = PaddingValues(top = top + 16.dp, bottom = bottom + jumpHeight + 14.dp, start = if (mode == "fluent") 24.dp else 16.dp, end = if (mode == "fluent") 24.dp else 16.dp),
        verticalArrangement = Arrangement.spacedBy(if (settings.compactDensity) 3.dp else if (mode == "apple") 4.dp else 5.dp)) {
        if (history.hasMore || history.loading) item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
            NativeButton(mode, if (history.loading) "読み込み中…" else "以前のメッセージ", enabled = !history.loading, onClick = ::requestOlder)
        } }
        itemsIndexed(messages, key = { _, message -> message.id }) { index, message ->
            val day = remember(message.createdAt) { calendarDay(message.createdAt.toDouble()) }
            val previousTime = messages.getOrNull(index - 1)?.createdAt
            val previousDay = remember(previousTime) { previousTime?.let { calendarDay(it.toDouble()) } }
            if (index == 0 || day != previousDay || mode == "apple" && previousTime != null && message.createdAt - previousTime > 900_000) Box(Modifier.fillMaxWidth().padding(vertical = 14.dp), contentAlignment = Alignment.Center) {
                Label(if (mode == "apple") calendarMoment(message.createdAt.toDouble()) else day, if (mode == "apple") 12 else 11, FontWeight.Medium, color = LocalSecondaryInk.current)
            }
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                Box(Modifier.widthIn(max = if (mode == "fluent") 1080.dp else 920.dp).fillMaxWidth()
                    .then(if (message.id == searchTarget || message.id == state.highlightMessageId) Modifier.background(LocalAccent.current.copy(alpha = .09f)) else Modifier)) {
                    if (message.hostContent) Box(Modifier.fillMaxWidth(), contentAlignment = if (message.authorId == "me") Alignment.CenterEnd else Alignment.CenterStart) {
                        NativeHostContent(message.id, state.epoch, chat.id, state.hostContentHeights[message.id], state.hostContentModels[message.id], state, message.hostRichContent)
                    } else MessageCell(message, mode, dark, settings, group, messageBounds, onMenu, onMedia,
                        canJoinCall = state.chatUi?.groupCall != null, joiningCall = state.chatUi?.joiningCall == true)
                }
            }
        }
    }
    if (showJump) Box(Modifier.align(Alignment.BottomCenter).padding(bottom = bottom).fillMaxWidth().height(jumpHeight), contentAlignment = Alignment.CenterEnd) {
        NativeButton(mode, "最新のメッセージへ", Modifier.padding(end = 14.dp)) {
            coordinator.intent(TimelineOwnership.Bottom)
        }
    }
    }
}

}

private fun messageInteractionNow(): Double = js("performance.now()")

@Composable
private fun MessageCell(message: ChatMessage, mode: String, dark: Boolean, settings: SettingsModel, group: Boolean, messageBounds: MutableMap<String, Rect>, onMenu: (ChatMessage) -> Unit, onMedia: (ChatMessage) -> Unit, canJoinCall: Boolean, joiningCall: Boolean) {
    val action = rememberScopedAction()
    val mine = message.authorId == "me"
    var swipeOffset by remember(message.id) { mutableFloatStateOf(0f) }
    var linkGesture by remember(message.id) { mutableStateOf(false) }
    var reactionDetailsVisible by remember(message.id) { mutableStateOf(false) }
    val messageFocus = remember(message.id) { FocusRequester() }
    val inputMode = LocalInputModeManager.current
    val profile = { action("reader-profile", id = message.authorId) }
    val system = message.kind in listOf("system", "call") || message.messageState.startsWith("revoked")
    if (system) {
        Box(Modifier.fillMaxWidth().padding(vertical = 10.dp)
            .then(if (message.messageState.startsWith("revoked")) Modifier.combinedClickable(onClick = { onMenu(message) }, onLongClick = { onMenu(message) }) else Modifier), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                if (message.kind == "call" && !message.messageState.startsWith("revoked")) {
                    val colors = LocalRendererColors.current
                    val tint = if (message.callMissed) colors.danger else colors.accentText
                    Row(Modifier.widthIn(max = 360.dp).clip(RoundedCornerShape(if (mode == "fluent") 6.dp else 22.dp))
                        .background(if (message.callMissed) colors.dangerContainer else colors.surface).padding(horizontal = 12.dp, vertical = 10.dp)
                        .semantics { contentDescription = message.text }, verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (mode == "apple") AppleGlyph(if (message.callVideo) AppleSymbol.Video else AppleSymbol.Phone, tint, 20)
                        else Glyph(if (message.callVideo) Icons.Regular.Video else Icons.Regular.Call, tint, 20)
                        Column(Modifier.weight(1f, fill = false)) {
                            Label(message.text, 12, FontWeight.Medium, color = if (message.callMissed) tint else LocalInk.current, maxLines = 3)
                            message.callDetail?.let { Label(if (mine) "あなた · $it" else it, 11, color = LocalSecondaryInk.current, maxLines = 2) }
                        }
                    }
                    if (message.callJoin && canJoinCall) NativeButton(mode, if (joiningCall) "参加中…" else "参加", enabled = !joiningCall) { action("join-call") }
                } else Label(message.text, 12, color = LocalSecondaryInk.current, maxLines = 5)
                Label(message.time, 10, color = LocalSecondaryInk.current)
            }
        }
        return
    }
    val readersAvailable = group && settings.showReaderList && message.status !in listOf("sending", "pending") && !message.id.startsWith("pending_")
    val colors = LocalRendererColors.current
    val bubble = when {
        message.kind == "sticker" -> Color.Transparent
        mine -> colors.outgoing
        else -> colors.incoming
    }
    val contentColor = if (mine) colors.onOutgoing else colors.onIncoming
    val shape = if (mode == "apple") RoundedRectangle(21.dp) else RoundedCornerShape(if (mode == "fluent") 5.dp else 22.dp)
    val previewed = LocalMessageMenuSelection.current == message.id
    Row(Modifier.fillMaxWidth().then(if (previewed) Modifier.graphicsLayer { alpha = 0f } else Modifier).padding(top = if (message.groupStart) 10.dp else 0.dp), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Bottom) {
        if (!mine && (group || mode != "apple")) {
            if (message.groupEnd) Box(Modifier.combinedClickable(enabled = group, role = Role.Button, onClick = profile).semantics { contentDescription = "${message.authorName}のプロフィール" }) {
                Avatar(ConversationRow(message.authorId, message.authorName, avatar = message.avatar, color = message.color, avatarUrl = message.avatarUrl), if (mode == "fluent") 30 else 28)
            }
            else Spacer(Modifier.width(if (mode == "fluent") 30.dp else 28.dp))
            Spacer(Modifier.width(8.dp))
        }
        BoxWithConstraints(Modifier.weight(1f, fill = false)) {
            val maximum = (maxWidth * if (mode == "apple") .78f else .86f).coerceAtMost(if (mode == "fluent") 640.dp else 520.dp)
            Column(Modifier.widthIn(max = maximum), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
                if (!mine && group && message.groupStart) Label(message.authorName, 11, FontWeight.Medium, color = LocalSecondaryInk.current, modifier = Modifier.combinedClickable(role = Role.Button, onClick = profile).semantics { contentDescription = "${message.authorName}のプロフィール" }.padding(start = 10.dp, bottom = 5.dp))
                Column(Modifier.onGloballyPositioned { messageBounds[message.id] = it.boundsInWindow() }.then(if (mode == "apple" && settings.bubbleTail && message.groupEnd && message.kind == "text") Modifier.appleMessageTail(bubble, mine) else Modifier).onPointerEvent(PointerEventType.Press, androidx.compose.ui.input.pointer.PointerEventPass.Initial) { linkGesture = false }
                    .messageSwipeReply(message.id, { linkGesture }, { swipeOffset = it }) { action("reply", id = message.id) }
                    .graphicsLayer { translationX = swipeOffset }.clip(shape).background(bubble)
                    .focusRequester(messageFocus)
                    .onPreviewKeyEvent { event ->
                        if (event.type == KeyEventType.KeyDown && (event.key == Key.Menu || event.key == Key.F10 && event.isShiftPressed)) { onMenu(message); true } else false
                    }
                    .combinedClickable(onClick = {}, onDoubleClick = { onMenu(message) }, onLongClick = { onMenu(message) })
                    .onPointerEvent(PointerEventType.Press) {
                        // Foundation's combinedClickable does not request mouse focus.
                        if (it.changes.any { change -> change.type == PointerType.Mouse }) {
                            inputMode.requestInputMode(InputMode.Keyboard)
                            messageFocus.requestFocus()
                        }
                        if (it.buttons.isSecondaryPressed) onMenu(message)
                    }
                    .semantics { stateDescription = "${message.time} ${if (mine) deliveryState(message, group) else message.authorName}"; customActions = listOf(CustomAccessibilityAction("返信") { action("reply", id = message.id); true }, CustomAccessibilityAction("メッセージの操作") { onMenu(message); true }) }
                    .padding(horizontal = if (mode == "apple") 15.dp else 14.dp, vertical = if (settings.compactDensity) 6.dp else if (mode == "apple") 8.dp else 10.dp)) {
                    message.replyText?.let { quote -> Row(Modifier.fillMaxWidth().padding(bottom = 8.dp).heightIn(min = 26.dp)
                        .combinedClickable(enabled = message.replyToId != null, onClick = { action("jump-message", id = message.replyToId) })
                        .semantics { contentDescription = "返信先へ移動" }, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(Modifier.width(3.dp).height(30.dp).background(contentColor.copy(alpha = .5f)))
                        Label(quote, 12, color = contentColor, maxLines = 2)
                    } }
                    if (message.mediaUrl != null && message.kind in listOf("image", "video", "audio", "sticker")) NativeMedia(message, mode, onContext = { onMenu(message) }) { onMedia(message) }
                    if (message.text.isNotBlank() && message.kind != "sticker") NativeRichText(message.text, message.segments, style = TextStyle(color = contentColor,
                        fontSize = ((if (mode == "apple") 17 else 15) * settings.fontScale).sp, lineHeight = ((if (mode == "apple") 22 else 21) * settings.fontScale).sp),
                        mentionColor = if (mine) colors.linkOutgoing else colors.linkIncoming, onLinkPress = { linkGesture = true })
                    if (message.kind != "text" && message.text.isBlank() && message.mediaUrl == null) Label(message.fileName ?: when (message.kind) { "image" -> "画像"; "video" -> "動画"; "audio" -> "音声メッセージ"; "sticker" -> "スタンプ"; else -> "添付メッセージ" }, 14, color = contentColor)
                }
                if (message.reactions.isNotEmpty()) {
                    FlowRow(Modifier.padding(top = 3.dp),
                        horizontalArrangement = Arrangement.spacedBy(4.dp, if (mine) Alignment.End else Alignment.Start),
                        verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        message.reactions.forEach { reaction -> Box(Modifier.clip(CircleShape).background(LocalAccent.current.copy(alpha = if (reaction.selected) .18f else .08f))
                            .combinedClickable(enabled = message.canReact, role = Role.Button, onClick = { action("react", id = message.id, value = reaction.key) }).semantics { contentDescription = "${reactionName(reaction.type)} ${reaction.count}件"; selected = reaction.selected }.padding(horizontal = 7.dp, vertical = 4.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                ControllerImage(reaction.iconUrl, "", Modifier.size(18.dp), ContentScale.Fit)
                                Label("${reaction.count}", 11)
                            }
                        } }
                        Box(Modifier.clip(CircleShape).background(LocalRendererColors.current.surface)
                            .combinedClickable(role = Role.Button, onClick = { reactionDetailsVisible = !reactionDetailsVisible })
                            .semantics { contentDescription = "リアクションした人を表示"; stateDescription = if (reactionDetailsVisible) "表示中" else "非表示" }
                            .padding(horizontal = 8.dp, vertical = 4.dp)) {
                            Label("詳細", 11, color = LocalSecondaryInk.current)
                        }
                    }
                    if (reactionDetailsVisible) Column(Modifier.padding(top = 6.dp).clip(RoundedCornerShape(12.dp))
                        .background(LocalRendererColors.current.surface).padding(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        message.reactions.forEach { reaction ->
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                ControllerImage(reaction.iconUrl, "", Modifier.size(16.dp), ContentScale.Fit)
                                Label("${reactionName(reaction.type)} ${reaction.count}件", 12, FontWeight.Medium)
                            }
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                reaction.reactors.forEach { reactor ->
                                    Box(Modifier.clip(CircleShape).background(LocalRendererColors.current.raised)
                                        .combinedClickable(role = Role.Button, onClick = { action("reader-profile", id = reactor.id) })
                                        .semantics { contentDescription = "${reactor.name}のプロフィール" }
                                        .padding(horizontal = 9.dp, vertical = 5.dp)) {
                                        Label(reactor.name, 11)
                                    }
                                }
                            }
                        }
                    }
                }
                if (message.edited || message.messageState == "edited") Label("編集済み", 11, color = if (mode == "apple") colors.accentText else LocalSecondaryInk.current,
                    modifier = Modifier.combinedClickable(role = Role.Button, onClick = { action("view-rich", id = message.id) }).semantics { contentDescription = "編集前のメッセージと履歴を表示" }.padding(top = 4.dp, start = 10.dp, end = 10.dp))
                Row(Modifier.padding(top = 4.dp, start = 10.dp, end = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Label(message.time, 10, color = LocalSecondaryInk.current)
                    if (mine && (!readersAvailable || message.readCount == 0)) Label(deliveryState(message, group), 10, color = if (message.status == "failed") colors.danger else colors.secondary,
                        modifier = if (message.canRetry) Modifier.combinedClickable(role = Role.Button, onClick = { action("retry", id = message.id) }).semantics { contentDescription = "送信に失敗したメッセージを再送信" } else Modifier)
                    if (readersAvailable) Label("既読 ${message.readCount}", 10, color = LocalSecondaryInk.current, modifier = Modifier
                        .combinedClickable(role = Role.Button, onClick = { action("readers", id = message.id) })
                        .semantics { contentDescription = "既読者一覧 ${message.readCount}人" })
                }
            }
        }
    }
}

@Composable
private fun NativeComposer(state: SidebarSnapshot, backdrop: Backdrop, compact: Boolean, modifier: Modifier, onToolsBoundsChanged: (Rect) -> Unit, onOpenTools: () -> Unit) {
    val action = rememberScopedAction()
    val chat = state.chat ?: return
    val host = state.composer
    var input by remember(chat.id) { mutableStateOf(TextFieldValue(host.text, TextRange(
        (host.selectionStart ?: host.text.length).coerceIn(0, host.text.length),
        (host.selectionEnd ?: host.text.length).coerceIn(0, host.text.length)))) }
    var awaitingEcho by remember(chat.id) { mutableStateOf<String?>(null) }
    var pendingCollapse by remember(chat.id) { mutableStateOf<TextFieldValue?>(null) }
    val composerScope = rememberCoroutineScope()
    var composerFocused by remember { mutableStateOf(false) }
    var mentionIndex by remember(host.mentionOptions) { mutableIntStateOf(host.mentionIndex) }
    var mentionsDismissed by remember(host.text) { mutableStateOf(false) }
    val pendingDraft = awaitingEcho
    SideEffect {
        if (host.text == pendingDraft) awaitingEcho = null
        // Host draft -> cleared draft can coalesce into one frame. Reconcile even when the String key is unchanged.
        if ((pendingDraft == null || host.text == pendingDraft) && host.text != input.text) {
            input = TextFieldValue(host.text, TextRange((host.selectionStart ?: host.text.length).coerceIn(0, host.text.length), (host.selectionEnd ?: host.text.length).coerceIn(0, host.text.length)))
        }
    }
    val publishChange: (TextFieldValue) -> Unit = { value ->
        input = value; awaitingEcho = value.text
        action("draft", value = value.text, selectionStart = value.selection.start, selectionEnd = value.selection.end)
    }
    val change: (TextFieldValue) -> Unit = { value ->
        val previous = input
        pendingCollapse = null
        // CoreTextField 1.12 calls manager.deselect() BEFORE our focus observer on
        // blur. Defer only that selection-only shape until focus dispatch finishes;
        // never publish the synthetic collapse to the retained host draft. A real
        // click/arrow at the same offset still commits when focus stays in the field.
        if (!previous.selection.collapsed && value.selection == TextRange(previous.selection.max) &&
            value.annotatedString == previous.annotatedString) {
            pendingCollapse = value
            composerScope.launch {
                kotlinx.coroutines.yield()
                if (pendingCollapse === value && input === previous) {
                    pendingCollapse = null
                    publishChange(value)
                }
            }
        } else publishChange(value) // Text edits and composition-only updates stay synchronous.
    }
    val disabled = chat.locked || chat.blocked || host.sending || !host.available
    val canSend = !disabled && if (host.pending.isNotEmpty()) host.canSendMedia else input.text.isNotBlank()
    val send = {
        if (canSend) {
            action("draft", value = input.text, selectionStart = input.selection.start, selectionEnd = input.selection.end)
            awaitingEcho = null
            action(if (host.pending.isNotEmpty()) "send-attachments" else "send")
        }
    }
    val colors = LocalRendererColors.current
    val surface = colors.input
    val accessoryShape = if (state.mode == "fluent") RoundedCornerShape(4.dp) else RoundedRectangle(20.dp)
    val outer = when (state.mode) {
        "apple" -> modifier.padding(horizontal = if (compact) 28.dp else 16.dp, vertical = if (compact) 26.dp else 10.dp)
        "miuix" -> modifier.padding(horizontal = 14.dp, vertical = 12.dp)
            .onFocusChanged { composerFocused = it.hasFocus }
            .miuixChrome(RoundedRectangle(24.dp), state.dark, focused = composerFocused)
        else -> modifier.background(surface).border(1.dp, LocalSecondaryInk.current.copy(alpha = .14f)).padding(horizontal = 12.dp, vertical = 10.dp)
    }
    Column(outer.padding(if (state.mode == "miuix") 8.dp else 0.dp)) {
        if (host.segments.any { it.type == "sticon" }) Box(Modifier.clip(accessoryShape).background(surface.copy(alpha = .96f)).padding(8.dp)) { ComposerEmojiPreview(host.segments) }
        if (host.pending.isNotEmpty()) Box(Modifier.clip(accessoryShape).background(surface.copy(alpha = .97f))) { PendingFiles(state) }
        if (!mentionsDismissed && host.mentionOptions.isNotEmpty()) Box(Modifier.clip(accessoryShape).background(surface.copy(alpha = .97f))) {
            MentionPicker(state, mentionIndex) { index -> awaitingEcho = null; action("mention", id = index.toString()) }
        }
        host.replyToId?.let { Row(Modifier.fillMaxWidth().padding(bottom = 8.dp).clip(accessoryShape).background(surface.copy(alpha = .96f)).padding(start = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Label("返信", 11, FontWeight.SemiBold, color = colors.accentText); Label(host.replyText ?: "メッセージ", 12, color = LocalSecondaryInk.current) }
            Command(state.mode, Icons.Regular.Dismiss, "返信をキャンセル", "cancel-reply")
        } }
        if (chat.locked || chat.blocked) Label(if (chat.locked) "このトークはロックされています" else "ブロック中の相手には送信できません", 12, color = LocalSecondaryInk.current, modifier = Modifier.padding(12.dp))
        else if (host.recording) Row(Modifier.fillMaxWidth()
            .then(if (state.mode == "apple") Modifier.appleLiquidBackdrop(rememberAppleLiquidMotion(enabled = false, reducedMotion = state.reducedMotion), backdrop, { RoundedRectangle(30.dp) }, colors.raised.copy(alpha = .8f), blurRadius = 20.dp) else Modifier.clip(accessoryShape).background(colors.raised))
            .padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Command(state.mode, Icons.Regular.Dismiss, "録音をキャンセル", "record-cancel")
            Row(Modifier.weight(1f).height(36.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                repeat(32) { index -> Box(Modifier.weight(1f).height((3 + (host.recordingLevels.getOrNull(index) ?: 0f) * 30).dp).clip(CircleShape).background(colors.danger)) }
            }
            Label("${host.recordingSeconds.toInt() / 60}:${(host.recordingSeconds.toInt() % 60).toString().padStart(2, '0')}", 14, color = colors.danger)
            NativeButton(state.mode, "音声を送信", modifier = Modifier.heightIn(min = 44.dp), enabled = host.canSendMedia, primary = true) { action("record-stop") }
        } else {
            val field = Modifier.heightIn(min = if (state.mode == "apple") 34.dp else 42.dp).semantics { contentDescription = "メッセージを入力" }
                .onFocusChanged {
                    if (!it.isFocused) {
                        pendingCollapse = null
                        // Blur commits the IME session even when its synthetic
                        // deselection is ignored. Never retain a stale composing range.
                        if (input.composition != null) input = input.copy(composition = null)
                    }
                }
                .onPreviewKeyEvent { event ->
                    if (event.type != KeyEventType.KeyDown || input.composition != null) false
                    else if (!mentionsDismissed && host.mentionOptions.isNotEmpty() && event.key == Key.DirectionDown) { mentionIndex = (mentionIndex + 1) % host.mentionOptions.size; true }
                    else if (!mentionsDismissed && host.mentionOptions.isNotEmpty() && event.key == Key.DirectionUp) { mentionIndex = (mentionIndex + host.mentionOptions.size - 1) % host.mentionOptions.size; true }
                    else if (!mentionsDismissed && host.mentionOptions.isNotEmpty() && (event.key == Key.Enter || event.key == Key.Tab)) { awaitingEcho = null; action("mention", id = mentionIndex.coerceIn(host.mentionOptions.indices).toString()); true }
                    else if (event.key == Key.Escape && !mentionsDismissed && host.mentionOptions.isNotEmpty()) { mentionsDismissed = true; true }
                    else if (event.key == Key.Escape && host.replyToId != null) { action("cancel-reply"); true }
                    else if (event.key == Key.Enter && !event.isShiftPressed && host.enterToSend && canSend) { send(); true } else false
                }
            if (state.mode == "apple") Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                val composerMotion = rememberAppleLiquidMotion(enabled = !disabled, reducedMotion = state.reducedMotion)
                AppleGlassIcon(backdrop, AppleSymbol.Plus, "添付とその他の操作",
                    modifier = Modifier.onGloballyPositioned { onToolsBoundsChanged(it.boundsInWindow()) }, dark = state.dark, onClick = onOpenTools)
                Row(Modifier.weight(1f)
                    .appleLiquidBackdrop(composerMotion, backdrop, { RoundedRectangle(25.dp) }, surface.copy(alpha = .82f), blurRadius = 14.dp, lensRadius = 9.dp, lensHeight = 16.dp)
                    .then(composerMotion.pointerModifier)
                    .padding(start = 15.dp, end = 6.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    BasicTextField(value = input, onValueChange = change, modifier = field.weight(1f).heightIn(min = 34.dp).padding(vertical = 6.dp), enabled = !disabled,
                        maxLines = 7, visualTransformation = SticonVisualTransformation, textStyle = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, color = LocalInk.current), cursorBrush = SolidColor(LocalAccent.current),
                        decorationBox = { text -> Box(contentAlignment = Alignment.CenterStart) { if (input.text.isEmpty()) Label("メッセージ", 16, color = colors.secondary); text() } })
                    AnimatedContent(targetState = input.text.isNotEmpty() || host.pending.isNotEmpty(),
                        modifier = Modifier.align(Alignment.CenterVertically), transitionSpec = {
                            val duration = if (state.reducedMotion) 0 else 160
                            (fadeIn(tween(duration)) + scaleIn(tween(duration), initialScale = .82f)) togetherWith
                                (fadeOut(tween(duration)) + scaleOut(tween(duration), targetScale = .82f))
                        }, label = "送信ボタン") { hasContent ->
                    val buttonEnabled = if (hasContent) canSend else host.available && host.voiceEnabled
                    val sendMotion = rememberAppleLiquidMotion(enabled = buttonEnabled, reducedMotion = state.reducedMotion)
                    if (!hasContent) Box(Modifier.size(36.dp)
                        .clickable(interactionSource = sendMotion.interactionSource, indication = null, enabled = buttonEnabled, role = Role.Button, onClick = { action("record-start") })
                        .then(sendMotion.pointerModifier)
                        .semantics { contentDescription = "音声メッセージを録音" }, contentAlignment = Alignment.Center) {
                        AppleGlyph(AppleSymbol.Waveform, LocalSecondaryInk.current.copy(alpha = .7f), 22)
                    } else Box(Modifier.size(44.dp)
                        .appleLiquidBackdrop(sendMotion, backdrop, { CircleShape }, if (canSend) colors.accent else colors.secondary.copy(alpha = .12f), blurRadius = 2.dp)
                        .clickable(interactionSource = sendMotion.interactionSource, indication = null, enabled = canSend, role = Role.Button, onClick = send)
                        .then(sendMotion.pointerModifier).semantics { contentDescription = "送信" }, contentAlignment = Alignment.Center) {
                        AppleGlyph(AppleSymbol.Send, if (canSend) colors.onAccent else colors.disabled, 28)
                    }
                    }
                }
            } else Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.onGloballyPositioned { onToolsBoundsChanged(it.boundsInWindow()) }) {
                    LocalIconButton(Icons.Regular.Add, "添付とその他の操作", state.mode, onClick = onOpenTools)
                }
                when (state.mode) {
                    "fluent" -> FluentTextField(value = input, onValueChange = change, modifier = field.weight(1f).heightIn(min = 44.dp), maxLines = 7, enabled = !disabled, visualTransformation = SticonVisualTransformation,
                        trailing = { Spacer(Modifier.height(36.dp)) },
                        placeholder = { Label("メッセージを入力", 14, color = LocalSecondaryInk.current, modifier = Modifier.fillMaxWidth()) })
                    else -> MiuixTextField(value = input, onValueChange = change, modifier = field.weight(1f).heightIn(min = 44.dp), maxLines = 7, enabled = !disabled, visualTransformation = SticonVisualTransformation,
                        insideMargin = androidx.compose.ui.unit.DpSize(12.dp, 8.dp), cornerRadius = 20.dp,
                        label = "メッセージ", useLabelAsPlaceholder = true, textStyle = TextStyle(fontSize = 16.sp, color = LocalInk.current))
                }
                if (input.text.isNotEmpty() || host.pending.isNotEmpty() || host.sending)
                    NativeButton(state.mode, if (host.sending) "送信中" else "送信", modifier = Modifier.heightIn(min = 44.dp), enabled = canSend, primary = true, onClick = send)
                else Command(state.mode, Icons.Regular.Mic, "音声メッセージを録音", "record-start", enabled = !disabled && host.voiceEnabled)
            }

        }
    }
}

@Composable
internal fun NativeButton(mode: String, label: String, modifier: Modifier = Modifier, enabled: Boolean = true, primary: Boolean = false, danger: Boolean = false, onClick: () -> Unit) {
    val interactive by rememberUpdatedState(enabled && LocalActionSurfaceEnabled.current)
    val guardedClick = { if (interactive) onClick() }
    val colors = LocalRendererColors.current

    when (mode) {
        "fluent" -> if (danger) {
            val native = io.github.composefluent.component.ButtonDefaults.buttonColors()
            FluentButton(onClick = guardedClick, modifier = modifier, disabled = !interactive,
                buttonColors = io.github.composefluent.component.ButtonDefaults.buttonColors(
                    default = native.default.copy(contentColor = colors.danger),
                    hovered = native.hovered.copy(contentColor = colors.danger),
                    pressed = native.pressed.copy(contentColor = colors.danger),
                    disabled = native.disabled)) { io.github.composefluent.component.Text(label) }
        } else if (primary) AccentButton(onClick = guardedClick, modifier = modifier, disabled = !interactive) { io.github.composefluent.component.Text(label) }
            else FluentButton(onClick = guardedClick, modifier = modifier, disabled = !interactive) { io.github.composefluent.component.Text(label) }
        "miuix" -> MiuixButton(onClick = guardedClick, modifier = modifier, enabled = interactive,
            colors = when {
                danger -> top.yukonga.miuix.kmp.basic.ButtonDefaults.buttonColors(contentColor = colors.danger)
                primary -> top.yukonga.miuix.kmp.basic.ButtonDefaults.buttonColorsPrimary()
                else -> top.yukonga.miuix.kmp.basic.ButtonDefaults.buttonColors()
            }) {
            top.yukonga.miuix.kmp.basic.Text(label, style = top.yukonga.miuix.kmp.theme.MiuixTheme.textStyles.button)
        }
        else -> Box(modifier.then(if (primary && label == "送信") Modifier.semantics { contentDescription = label } else Modifier).clip(CircleShape).background(if (primary && !danger && interactive) colors.accent else colors.secondary.copy(alpha = .08f))
            .combinedClickable(enabled = interactive, role = Role.Button, onClick = guardedClick).padding(horizontal = 16.dp, vertical = 12.dp)) {
                val foreground = when {
                    !interactive -> colors.disabled
                    danger -> colors.danger
                    primary -> colors.onAccent
                    else -> colors.accentText
                }
                if (primary && label == "送信") AppleGlyph(AppleSymbol.Send, foreground, 28)
                else Label(label, 14, FontWeight.SemiBold, color = foreground)
            }
    }
}

internal fun reactionSymbol(type: Int): String = when (type) { 2 -> "👍"; 3 -> "❤️"; 4 -> "😆"; 5 -> "😮"; 6 -> "😢"; 7 -> "😲"; else -> "＋" }
internal fun reactionName(type: Int): String = when (type) { 2 -> "いいね"; 3 -> "ハート"; 4 -> "笑い"; 5 -> "驚き"; 6 -> "悲しい"; 7 -> "びっくり"; else -> "リアクション" }

private fun calendarDay(milliseconds: Double): String = js("(window.vylineDayFormatter ??= new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })).format(new Date(milliseconds))")



private fun deliveryState(message: ChatMessage, group: Boolean): String = when {
    message.status == "failed" -> "送信失敗"
    message.status == "sending" || message.status == "pending" -> "送信中…"
    message.readCount > 0 -> if (group) "既読 ${message.readCount}" else "既読"
    else -> "配信済み"
}

private fun calendarMoment(milliseconds: Double): String = js("""(() => {
    const date = new Date(milliseconds);
    const year = date.getFullYear() === new Date().getFullYear() ? '' : date.getFullYear() + '年';
    return year + (date.getMonth() + 1) + '月' + date.getDate() + '日(' + ['日','月','火','水','木','金','土'][date.getDay()] + ') '
        + date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
})()""")
