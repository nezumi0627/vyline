@file:OptIn(kotlin.js.ExperimentalWasmJsInterop::class)

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.decodeFromJsonElement

@Serializable
data class ChatModel(val id: String, val title: String, val status: String = "", val avatar: String = "", val color: String = "",
    val avatarUrl: String? = null, val isGroup: Boolean = false, val locked: Boolean = false, val blocked: Boolean = false,
    val muted: Boolean = false, val pinned: Boolean = false, val canCall: Boolean = false, val canVideoCall: Boolean = canCall, val canBlock: Boolean = false,
    val members: List<ChatMember> = emptyList())

@Serializable
data class ChatMember(val id: String, val name: String, val avatar: String = "", val color: String = "", val avatarUrl: String? = null)

@Serializable
data class MessageReactor(val id: String, val name: String, val atMillis: Double = 0.0)

@Serializable
data class MessageReaction(val type: Int, val count: Int, val selected: Boolean, val key: String = type.toString(), val iconUrl: String = "", val reactors: List<MessageReactor> = emptyList())

@Serializable
data class MessageReader(val id: String, val name: String, val readAt: Double? = null)

@Serializable
data class ReadersPanel(val messageId: String, val loading: Boolean = false)

@Serializable
data class MessageDelta(val updates: List<ChatMessage>, val ids: List<String>? = null)

@Serializable
data class TextSegment(val type: String, val value: String? = null, val url: String? = null, val alt: String? = null, val mid: String? = null, val all: Boolean = false)

@Serializable
data class ChatMessage(val id: String, val authorId: String, val authorName: String = "", val avatar: String = "", val color: String = "", val avatarUrl: String? = null,
    val kind: String = "text", val text: String = "", val createdAt: Long = 0, val time: String = "", val status: String = "",
    val messageState: String = "", val canRetry: Boolean = false, val canReact: Boolean = false,
    val readCount: Int = 0, val replyToId: String? = null, val replyText: String? = null,
    val mediaUrl: String? = null, val audioSeconds: Double? = null, val fileName: String? = null,
    val reactions: List<MessageReaction> = emptyList(), val groupStart: Boolean = true, val groupEnd: Boolean = true,
    val edited: Boolean = false, val segments: List<TextSegment> = emptyList(),
    val readers: List<MessageReader> = emptyList(), val stickerAnimated: Boolean = false, val hostContent: Boolean = false,
    val hostRichContent: Boolean = false,
    val callDetail: String? = null, val callVideo: Boolean = false, val callMissed: Boolean = false, val callJoin: Boolean = false)

@Serializable
data class PendingAttachment(val id: String, val name: String, val url: String, val kind: String)

@Serializable
data class MentionOption(val mid: String? = null, val all: Boolean = false, val name: String)

@Serializable
data class ComposerModel(val text: String = "", val replyToId: String? = null, val replyText: String? = null,
    val pending: List<PendingAttachment> = emptyList(), val recording: Boolean = false, val recordingSeconds: Double = 0.0, val recordingLevels: List<Float> = emptyList(),
    val sending: Boolean = false, val enterToSend: Boolean = true, val voiceEnabled: Boolean = true, val mute: Boolean = false,
    val available: Boolean = false, val selectionStart: Int? = null, val selectionEnd: Int? = null,
    val mentionOptions: List<MentionOption> = emptyList(), val mentionIndex: Int = 0, val canSendMedia: Boolean = false,
    val segments: List<TextSegment> = emptyList())

@Serializable
data class SettingsModel(val enterToSend: Boolean = true, val voiceMessagesEnabled: Boolean = true,
    val compactDensity: Boolean = false, val bubbleTail: Boolean = true, val fontScale: Double = 1.0, val showReaderList: Boolean = true)

@Serializable
data class HistoryModel(val hasMore: Boolean = false, val loading: Boolean = false)

@Serializable
data class ChatSearch(val open: Boolean = false, val query: String = "", val index: Int = 0, val count: Int = 0, val activeId: String? = null)
@Serializable
data class ActiveGroupCall(val kind: String, val memberCount: Int = 0)
@Serializable
data class ChatUi(val search: ChatSearch = ChatSearch(), val groupCall: ActiveGroupCall? = null, val joiningCall: Boolean = false, val refreshing: Boolean = false, val announcementExpanded: Boolean = false)
@Serializable
data class ChatAnnouncement(val id: String, val text: String, val messageId: String? = null)

@Serializable
data class HostMenuItem(val id: String, val label: String, val danger: Boolean = false, val children: List<HostMenuItem> = emptyList(), val iconUrl: String? = null)

@Serializable
data class HostMenuMessage(val id: String, val text: String, val kind: String, val mine: Boolean, val mediaUrl: String? = null, val width: Float? = null, val fontScale: Float = 1f, val compact: Boolean = false)

@Serializable
data class HostMenu(val id: String, val x: Double, val y: Double, val items: List<HostMenuItem>, val message: HostMenuMessage? = null)

@Serializable
data class NativePanelOption(val value: String, val label: String)
@Serializable
data class NativeSceneLayer(val id: String, val label: String, val url: String, val x: Float, val y: Float, val size: Float,
    val xId: String, val yId: String, val sizeId: String, val removeId: String)
@Serializable
data class NativePanelItem(val id: String, val kind: String, val label: String, val description: String? = null,
    val backgroundUrl: String? = null,
    val minimum: Float = 0f, val maximum: Float = 1f, val step: Float = 1f,
    val symbol: String? = null, val caption: String? = null, val live: Boolean = false, val size: Int = 84, val color: String = "#8995C6",
    val value: String = "", val url: String? = null, val largeImage: Boolean = false, val showLabel: Boolean = true, val mediaId: String? = null, val mediaVersion: String = "", val autoplay: Boolean = false, val disabled: Boolean = false, val danger: Boolean = false,
    val primary: Boolean = false, val multiline: Boolean = false, val secret: Boolean = false, val readOnly: Boolean = false, val secondary: Boolean = false, val confirm: String? = null,
    val options: List<NativePanelOption> = emptyList(), val items: List<NativePanelItem> = emptyList(),
    val sceneSize: Float = 240f, val minSize: Float = 40f, val maxSize: Float = 240f, val layers: List<NativeSceneLayer> = emptyList())
@Serializable
data class NativePanelConfirmation(val id: String, val text: String)
@Serializable
data class NativePanel(val id: String, val title: String, val items: List<NativePanelItem>, val compact: Boolean = false, val presentation: String? = null, val callLayout: String? = null, val confirmation: NativePanelConfirmation? = null)
@Serializable
data class ControllerDialog(val id: String, val text: String, val prompt: Boolean = false, val value: String = "",
    val title: String? = null, val acceptLabel: String? = null, val cancelFirst: Boolean = false)

@Serializable
data class SidebarTab(val id: String, val label: String)

@Serializable
data class SidebarProfile(val name: String = "", val status: String = "", val avatar: String = "", val avatarUrl: String? = null)

@Serializable
data class ConversationRow(
    val id: String,
    val title: String,
    val preview: String = "",
    val time: String = "",
    val unread: Int = 0,
    val avatar: String = "",
    val color: String = "",
    val avatarUrl: String? = null,
    val selected: Boolean = false,
    val pinned: Boolean = false,
    val muted: Boolean = false,
    val locked: Boolean = false,
)

@Serializable
data class KmpPaneSnapshot(
    val id: String,
    val chat: ChatModel,
    val messages: List<ChatMessage> = emptyList(),
    val composer: ComposerModel = ComposerModel(),
    val history: HistoryModel = HistoryModel(),
    val chatUi: ChatUi? = null,
    val announcements: List<ChatAnnouncement> = emptyList(),
    val highlightMessageId: String? = null,
    val scrollLatest: Int = 0,
    val profileOpen: Boolean = false,
    val readersPanel: ReadersPanel? = null,
)

@Serializable
data class PaneRect(val x: Double, val y: Double, val width: Double, val height: Double)

@Serializable
data class SidebarSnapshot(
    val channel: String = "vyline-ui",
    val version: Int = 1,
    val type: String = "snapshot",
    val epoch: Int = 1,
    val mode: String = "apple",
    val dark: Boolean = false,
    val reducedMotion: Boolean = false,
    val query: String = "",
    val tab: String = "all",
    val tabs: List<SidebarTab> = emptyList(),
    val rows: List<ConversationRow> = emptyList(),
    val profile: SidebarProfile = SidebarProfile(),
    val sortLabel: String = "並び替え",
    val chatSort: String = "recent",
    val sidebarWidth: Double = 360.0,
    val sidebarCollapsed: Boolean = false,
    val desktopInteraction: Boolean = true,
    val canRefresh: Boolean = false,
    val splitPick: Boolean = false,
    val view: String = "chat",
    val appearance: String = "system",
    val chat: ChatModel? = null,
    val messages: List<ChatMessage> = emptyList(),
    val composer: ComposerModel = ComposerModel(),
    val settings: SettingsModel = SettingsModel(),
    val notice: String = "",
    val history: HistoryModel = HistoryModel(),
    val hostMenu: HostMenu? = null,
    val nativePanel: NativePanel? = null,
    val controllerDialog: ControllerDialog? = null,
    val controllerCall: NativePanel? = null,
    val readersPanel: ReadersPanel? = null,
    val hostContentHeights: Map<String, Double> = emptyMap(),
    val hostContentModels: Map<String, NativePanel> = emptyMap(),
    val chatUi: ChatUi? = null,
    val announcements: List<ChatAnnouncement> = emptyList(),
    val highlightMessageId: String? = null,
    val scrollLatest: Int = 0,
    val profileOpen: Boolean = false,
    val panes: List<KmpPaneSnapshot> = emptyList(),
    val paneRects: List<PaneRect> = emptyList(),
    val paneLayout: String = "columns",
)

@Serializable
private data class HostAction(
    val channel: String = "vyline-ui",
    val version: Int = 1,
    val type: String = "action",
    val action: String,
    val epoch: Int,
    val chatId: String? = null,
    val id: String? = null,
    val value: String? = null,
    val x: Float? = null,
    val y: Float? = null,
    val selectionStart: Int? = null,
    val selectionEnd: Int? = null,
)

internal val bridgeJson = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false }
var snapshot by mutableStateOf(SidebarSnapshot())
    private set
private var interactionEpoch = 1
private var interactionChatId: String? = null

fun receiveSnapshot(serialized: String) {
    val data = runCatching { bridgeJson.parseToJsonElement(serialized).jsonObject }.getOrNull() ?: return
    if (data["channel"]?.jsonPrimitive?.content != "vyline-ui" || data["version"]?.jsonPrimitive?.intOrNull != 1) return
    val next = runCatching {
        when (data["type"]?.jsonPrimitive?.content) {
            "snapshot" -> bridgeJson.decodeFromJsonElement<SidebarSnapshot>(data)
            "patch" -> snapshot.copy(
                epoch = data.field("epoch", snapshot.epoch),
                mode = data.field("mode", snapshot.mode), dark = data.field("dark", snapshot.dark), reducedMotion = data.field("reducedMotion", snapshot.reducedMotion),
                query = data.field("query", snapshot.query), tab = data.field("tab", snapshot.tab), tabs = data.field("tabs", snapshot.tabs), rows = data.field("rows", snapshot.rows),
                profile = data.field("profile", snapshot.profile), sortLabel = data.field("sortLabel", snapshot.sortLabel), canRefresh = data.field("canRefresh", snapshot.canRefresh),
                splitPick = data.field("splitPick", snapshot.splitPick), view = data.field("view", snapshot.view), appearance = data.field("appearance", snapshot.appearance),
                chat = data.field("chat", snapshot.chat), messages = when {
                    data.containsKey("messages") -> data.field("messages", snapshot.messages)
                    data.containsKey("messageDelta") -> applyMessageDelta(snapshot.messages, bridgeJson.decodeFromJsonElement<MessageDelta>(data.getValue("messageDelta")))
                    else -> snapshot.messages
                }, composer = data.field("composer", snapshot.composer),
                settings = data.field("settings", snapshot.settings), notice = data.field("notice", snapshot.notice), history = data.field("history", snapshot.history),
                hostMenu = data.field("hostMenu", snapshot.hostMenu), readersPanel = data.field("readersPanel", snapshot.readersPanel),
                nativePanel = data.field("nativePanel", snapshot.nativePanel),
                controllerDialog = data.field("controllerDialog", snapshot.controllerDialog),
                controllerCall = data.field("controllerCall", snapshot.controllerCall),
                hostContentHeights = data.field("hostContentHeights", snapshot.hostContentHeights),
                hostContentModels = data.field("hostContentModels", snapshot.hostContentModels),
                chatUi = data.field("chatUi", snapshot.chatUi), announcements = data.field("announcements", snapshot.announcements),
                highlightMessageId = data.field("highlightMessageId", snapshot.highlightMessageId), scrollLatest = data.field("scrollLatest", snapshot.scrollLatest),
                profileOpen = data.field("profileOpen", snapshot.profileOpen),
                chatSort = data.field("chatSort", snapshot.chatSort), sidebarWidth = data.field("sidebarWidth", snapshot.sidebarWidth),
                sidebarCollapsed = data.field("sidebarCollapsed", snapshot.sidebarCollapsed), desktopInteraction = data.field("desktopInteraction", snapshot.desktopInteraction),
                panes = when {
                    data.containsKey("panes") -> data.field("panes", snapshot.panes)
                    data.containsKey("panePatches") -> applyPanePatches(snapshot.panes, data.getValue("panePatches").jsonObject)
                    else -> snapshot.panes
                }, paneRects = data.field("paneRects", snapshot.paneRects), paneLayout = data.field("paneLayout", snapshot.paneLayout))
            else -> return
        }
    }.getOrElse {
        // Reuse the ready handshake to request one authoritative full snapshot after a broken delta.
        if (data.containsKey("messageDelta") || data.containsKey("panePatches")) postToHost("""{"channel":"vyline-ui","version":1,"type":"ready","messageDelta":true,"hostMenu":true,"panes":true}""")
        return
    }
    if (next.mode !in listOf("apple", "fluent", "miuix")) return
    if (next.epoch < snapshot.epoch) return
    if (next.rows !== snapshot.rows && (next.rows.any { it.id.isBlank() } || next.rows.distinctBy { it.id }.size != next.rows.size)) return
    if (data.containsKey("messages") && next.messages !== snapshot.messages && next.messages.distinctBy { it.id }.size != next.messages.size) return
    if (next.panes !== snapshot.panes) {
        if (next.panes.size > 4 || next.panes.any { it.id.isBlank() || it.chat.id != it.id } || next.panes.distinctBy { it.id }.size != next.panes.size) return
        if (next.panes.any { pane ->
            pane.messages !== snapshot.panes.find { it.id == pane.id }?.messages && pane.messages.distinctBy { it.id }.size != pane.messages.size
        }) return
    }
    if (next.paneRects !== snapshot.paneRects && next.paneRects.any {
        !it.x.isFinite() || !it.y.isFinite() || !it.width.isFinite() || !it.height.isFinite() ||
            it.x < 0 || it.y < 0 || it.width <= 0 || it.height <= 0 || it.x + it.width > 100.01 || it.y + it.height > 100.01
    }) return
    snapshot = next
}

private fun applyPanePatches(previous: List<KmpPaneSnapshot>, patches: JsonObject): List<KmpPaneSnapshot> {
    if (patches.isEmpty()) return previous
    require(patches.keys.all { id -> previous.any { it.id == id } }) { "Unknown pane update" }
    var changed = false
    val next = previous.map { pane ->
        val patch = patches[pane.id]?.jsonObject ?: return@map pane
        val updated = pane.copy(
            chat = patch.field("chat", pane.chat),
            messages = when {
                patch.containsKey("messages") -> patch.field("messages", pane.messages)
                patch.containsKey("messageDelta") -> applyMessageDelta(pane.messages, bridgeJson.decodeFromJsonElement<MessageDelta>(patch.getValue("messageDelta")))
                else -> pane.messages
            }, composer = patch.field("composer", pane.composer), history = patch.field("history", pane.history),
            chatUi = patch.field("chatUi", pane.chatUi), announcements = patch.field("announcements", pane.announcements),
            highlightMessageId = patch.field("highlightMessageId", pane.highlightMessageId), scrollLatest = patch.field("scrollLatest", pane.scrollLatest),
            profileOpen = patch.field("profileOpen", pane.profileOpen), readersPanel = patch.field("readersPanel", pane.readersPanel))
        if (updated == pane) pane else updated.also { changed = true }
    }
    return if (changed) next else previous
}

private fun applyMessageDelta(previous: List<ChatMessage>, delta: MessageDelta): List<ChatMessage> {
    val updates = delta.updates.associateBy { it.id }
    require(updates.size == delta.updates.size) { "Duplicate message updates" }
    val ids = delta.ids
    if (ids == null) {
        if (updates.isEmpty()) return previous
        var matched = 0
        val next = previous.map { message -> updates[message.id]?.also { matched++ }?.takeUnless { it == message } ?: message }
        require(matched == updates.size) { "Unknown message update" }
        return next
    }
    val byId = previous.associateByTo(HashMap(previous.size + updates.size)) { it.id }
    byId.putAll(updates)
    val seen = HashSet<String>(ids.size)
    return ids.map { id ->
        require(seen.add(id)) { "Duplicate message order" }
        requireNotNull(byId[id]) { "Unknown message in order" }
    }
}

fun commitInteractionContext(epoch: Int, chatId: String?, acceptFiles: Boolean) {
    interactionEpoch = epoch
    interactionChatId = chatId
    acceptFileEvents(acceptFiles, epoch, chatId)
}

private inline fun <reified T> JsonObject.field(name: String, previous: T): T =
    if (containsKey(name)) bridgeJson.decodeFromJsonElement<T>(getValue(name)) else previous

@Immutable
internal data class UiActionScope(val epoch: Int, val chatId: String?, val acceptFiles: Boolean) {
    operator fun invoke(action: String, id: String? = null, value: String? = null, x: Float? = null, y: Float? = null, selectionStart: Int? = null, selectionEnd: Int? = null) {
        postToHost(bridgeJson.encodeToString(HostAction(action = action, epoch = epoch, chatId = chatId, id = id, value = value, x = x, y = y, selectionStart = selectionStart, selectionEnd = selectionEnd)))
    }

    fun activateFiles() = commitInteractionContext(epoch, chatId, acceptFiles)
}

internal val LocalUiActionScope = staticCompositionLocalOf<UiActionScope> { error("UI actions require a committed scope") }

@Composable
internal fun rememberScopedAction(): UiActionScope = LocalUiActionScope.current

// ComposeViewport owns its focusable canvas in this shadow host. Explicit modal
// transitions from HTML interop must move DOM focus as well as Compose focus.
internal fun focusComposeCanvas(): Unit = js("""{
    const host = document.querySelector('#composeApp > div > div');
    host?.shadowRoot?.querySelector('canvas[tabindex="0"]')?.focus({ preventScroll: true });
}""")

// Only the same-origin parent supplies display state; credentials and API calls remain in the host.
fun listenToHost(receive: (String) -> Unit): Unit = js("""{
    const runtimeError = () => window.parent.postMessage({ channel: 'vyline-ui', version: 1, type: 'error', message: 'renderer-runtime-error' }, window.location.origin);
    window.addEventListener('error', runtimeError);
    window.addEventListener('unhandledrejection', runtimeError);
    window.addEventListener('message', function(event) {
        if (event.source !== window.parent || event.origin !== window.location.origin) return;
        let value = event.data;
        if (typeof value === 'string') {
            if (value.length > 4000000) return;
            try { value = JSON.parse(value); } catch (_) { return; }
        }
        if (!value || value.channel !== 'vyline-ui' || value.version !== 1 || !['snapshot','patch'].includes(value.type)) return;
        const serialized = JSON.stringify(value);
        if (serialized.length <= 4000000) receive(serialized);
    });
    window.addEventListener('contextmenu', function(event) { event.preventDefault(); });
    const paneAt = (event) => {
        for (const pane of window.vylinePaneBounds?.values() ?? []) {
            if (pane.epoch === window.vylineUiEpoch && event.clientX >= pane.left && event.clientX < pane.right && event.clientY >= pane.top && event.clientY < pane.bottom) return pane;
        }
    };
    const activatePane = (pane) => {
        const changed = window.vylineUiChatId !== pane.chatId;
        window.vylineAcceptFiles = true;
        window.vylineUiEpoch = pane.epoch;
        window.vylineUiChatId = pane.chatId;
        if (changed) window.parent.postMessage({ channel: 'vyline-ui', version: 1, type: 'action', action: 'pane-focus', epoch: pane.epoch, chatId: pane.chatId, id: pane.chatId }, window.location.origin);
    };
    let mousePointer = null;
    for (const type of ['pointerenter', 'pointermove', 'pointerdown', 'pointerup', 'pointerleave']) window.addEventListener(type, function(event) {
        const canvas = event.composedPath().find(node => node instanceof HTMLCanvasElement);
        if (canvas && event.pointerType === 'mouse') {
            mousePointer = event.type === 'pointerleave' ? null : { canvas, event };
        } else if (canvas && event.type === 'pointerdown' && event.pointerType === 'touch' &&
                   mousePointer?.canvas === canvas && mousePointer.event.buttons === 0) {
            // Compose 1.12 retains a hovering mouse in the next touch event.
            // Foundation awaitFirstDown requires every pointer to go down, so
            // that idle mouse blocks taps/press animations. Retire hover first;
            // an actively held mouse button and HTML controls remain untouched.
            const mouse = mousePointer.event;
            mousePointer = null;
            canvas.dispatchEvent(new PointerEvent('pointerleave', {
                pointerId: mouse.pointerId, pointerType: 'mouse', buttons: 0, button: -1,
                clientX: mouse.clientX, clientY: mouse.clientY, bubbles: true, composed: true
            }));
        }
        if (event.type !== 'pointerdown') return;
        // Touching a canvas does not focus its iframe in Chromium. Keep keyboard
        // events in the renderer after touch, without stealing focus from HTML media/input.
        let focused = document.activeElement;
        while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
        const editing = focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement || focused?.isContentEditable;
        if (canvas && !editing) canvas.focus({ preventScroll: true });
        const pane = paneAt(event);
        if (pane) activatePane(pane);
    }, true);
    window.addEventListener('dragover', function(event) {
        if (!paneAt(event) && !window.vylineAcceptFiles) return;
        if (event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
    });
    window.addEventListener('drop', function(event) {
        const pane = paneAt(event);
        if (pane) activatePane(pane);
        else if (window.vylinePaneBounds?.size) return;
        if (!window.vylineAcceptFiles) return;
        const files = event.dataTransfer ? Array.from(event.dataTransfer.files) : [];
        if (!files.length) return;
        event.preventDefault();
        window.parent.postMessage({ channel: 'vyline-ui', version: 1, type: 'files', files, epoch: window.vylineUiEpoch, chatId: window.vylineUiChatId }, window.location.origin);
    });
    window.addEventListener('paste', function(event) {
        if (!window.vylineAcceptFiles) return;
        const files = event.clipboardData ? Array.from(event.clipboardData.files) : [];
        if (!files.length) return;
        event.preventDefault();
        window.parent.postMessage({ channel: 'vyline-ui', version: 1, type: 'files', files, epoch: window.vylineUiEpoch, chatId: window.vylineUiChatId }, window.location.origin);
    });
}""")

internal fun checkMessageDelta() {
    val first = ChatMessage("a", "me", text = "first")
    val second = ChatMessage("b", "friend", text = "second")
    val updated = second.copy(readCount = 1)
    val previous = listOf(first, second)
    val changed = applyMessageDelta(previous, MessageDelta(listOf(updated)))
    check(changed[0] === first && changed[1] === updated)
    check(applyMessageDelta(previous, MessageDelta(emptyList())) === previous)
    check(applyMessageDelta(previous, MessageDelta(emptyList(), listOf("b"))) == listOf(second))
    check(runCatching { applyMessageDelta(previous, MessageDelta(emptyList(), listOf("missing"))) }.isFailure)
    val panes = listOf(KmpPaneSnapshot("one", ChatModel("one", "One"), previous), KmpPaneSnapshot("two", ChatModel("two", "Two"), previous))
    val patched = applyPanePatches(panes, bridgeJson.parseToJsonElement("""{"two":{"composer":{"text":"draft"},"messageDelta":{"updates":[{"id":"b","authorId":"friend","text":"updated"}]}}}""").jsonObject)
    check(patched[0] === panes[0] && patched[1].messages[0] === first && patched[1].composer.text == "draft")
    check(patched[1].messages[1].text == "updated" && patched[1].history === panes[1].history)
    check(applyPanePatches(panes, bridgeJson.parseToJsonElement("""{"two":{}}""").jsonObject) === panes)
    check(runCatching { applyPanePatches(panes, bridgeJson.parseToJsonElement("""{"missing":{}}""").jsonObject) }.isFailure)
    val firstScope = UiActionScope(4, "one", true)
    val secondScope = UiActionScope(4, "two", true)
    check(firstScope.chatId == "one" && secondScope.chatId == "two" && firstScope.copy(epoch = 5).chatId == "one")
}

private fun acceptFileEvents(accept: Boolean, epoch: Int, chatId: String?): Unit = js("{ window.vylineAcceptFiles = accept; window.vylineUiEpoch = epoch; window.vylineUiChatId = chatId; }")

fun postToHost(serialized: String): Unit = js("""{
    window.parent.postMessage(JSON.parse(serialized), window.location.origin);
}""")
