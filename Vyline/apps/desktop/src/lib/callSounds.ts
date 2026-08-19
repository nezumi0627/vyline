/**
 * lib/callSounds.ts — 着信音・通話終了効果音（Knot/LEINs の「着信音を利用する」
 * 「オリジナルの着信音に変更」「通話終了時に効果音を再生」に相当）
 *
 * 既定音は Web Audio API のオシレーターで合成する（ライセンス不要・軽量）。
 * ユーザーがカスタム音声ファイル（mp3/wav/ogg）をアップロードすると、
 * lib/customFont.ts と同じパターンで IndexedDB に保存し、以後はそちらを再生する。
 */

const DB_NAME = "vyline-call-sounds";
const STORE_NAME = "sounds";
const RINGTONE_KEY = "ringtone";
const END_SOUND_KEY = "end";

export interface CallSoundRecord {
	name: string;
	data: ArrayBuffer;
	mime: string;
	savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE_NAME))
				db.createObjectStore(STORE_NAME);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
	});
}

async function idbGet(key: string): Promise<CallSoundRecord | undefined> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readonly");
		const req = tx.objectStore(STORE_NAME).get(key);
		req.onsuccess = () => resolve(req.result as CallSoundRecord | undefined);
		req.onerror = () => reject(req.error ?? new Error("indexedDB get failed"));
	});
}

async function idbSet(key: string, record: CallSoundRecord): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		tx.objectStore(STORE_NAME).put(record, key);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error("indexedDB put failed"));
	});
}

async function idbDelete(key: string): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		tx.objectStore(STORE_NAME).delete(key);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error("indexedDB delete failed"));
	});
}

let sharedCtx: AudioContext | null = null;
function getCtx(): AudioContext {
	if (!sharedCtx || sharedCtx.state === "closed") {
		sharedCtx = new AudioContext();
	}
	return sharedCtx;
}

/** 合成トーンで「ピロピロ…」と2音を鳴らす（1サイクル） */
function synthRingCycle(ctx: AudioContext, startAt: number): number {
	const toneLen = 0.35;
	const gap = 0.15;
	const freqs = [880, 660];
	let t = startAt;
	for (const f of freqs) {
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = "sine";
		osc.frequency.value = f;
		gain.gain.setValueAtTime(0, t);
		gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
		gain.gain.linearRampToValueAtTime(0, t + toneLen);
		osc.connect(gain).connect(ctx.destination);
		osc.start(t);
		osc.stop(t + toneLen);
		t += toneLen;
	}
	return t + gap;
}

/** 合成の通話終了チャイム（下降2音） */
function synthEndChime(ctx: AudioContext): void {
	const t0 = ctx.currentTime;
	const notes: Array<[number, number]> = [
		[523.25, t0],
		[392.0, t0 + 0.16],
	];
	for (const [f, t] of notes) {
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = "sine";
		osc.frequency.value = f;
		gain.gain.setValueAtTime(0, t);
		gain.gain.linearRampToValueAtTime(0.2, t + 0.02);
		gain.gain.linearRampToValueAtTime(0, t + 0.28);
		osc.connect(gain).connect(ctx.destination);
		osc.start(t);
		osc.stop(t + 0.3);
	}
}

let ringLoopTimer: ReturnType<typeof setTimeout> | null = null;
let ringAudioEl: HTMLAudioElement | null = null;

function stopSynthRing(): void {
	if (ringLoopTimer) {
		clearTimeout(ringLoopTimer);
		ringLoopTimer = null;
	}
}

function stopCustomRing(): void {
	if (ringAudioEl) {
		ringAudioEl.pause();
		ringAudioEl.currentTime = 0;
		ringAudioEl = null;
	}
}

export function stopRingtone(): void {
	stopSynthRing();
	stopCustomRing();
}

/** 着信音の再生を開始する（カスタム音があればそちらをループ、無ければ合成音） */
export async function playRingtone(): Promise<void> {
	stopRingtone();
	try {
		const record = await idbGet(RINGTONE_KEY);
		if (record) {
			const blob = new Blob([record.data], { type: record.mime });
			const url = URL.createObjectURL(blob);
			const audio = new Audio(url);
			audio.loop = true;
			audio.volume = 0.6;
			ringAudioEl = audio;
			await audio.play().catch(() => undefined);
			return;
		}
	} catch {
		/* フォールバックへ */
	}

	// 合成音をループ再生
	const ctx = getCtx();
	if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
	const loop = () => {
		const next = synthRingCycle(ctx, ctx.currentTime);
		const delayMs = Math.max(50, (next - ctx.currentTime) * 1000);
		ringLoopTimer = setTimeout(loop, delayMs);
	};
	loop();
}

/** 通話終了時に一度だけ鳴らす */
export async function playCallEndSound(): Promise<void> {
	try {
		const record = await idbGet(END_SOUND_KEY);
		if (record) {
			const blob = new Blob([record.data], { type: record.mime });
			const url = URL.createObjectURL(blob);
			const audio = new Audio(url);
			audio.volume = 0.6;
			await audio.play().catch(() => undefined);
			return;
		}
	} catch {
		/* フォールバックへ */
	}
	try {
		const ctx = getCtx();
		if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
		synthEndChime(ctx);
	} catch {
		/* 効果音再生失敗は致命的ではない */
	}
}

export type CallSoundKind = "ringtone" | "end";

export async function setCustomCallSound(
	kind: CallSoundKind,
	file: File,
): Promise<void> {
	const data = await file.arrayBuffer();
	await idbSet(kind === "ringtone" ? RINGTONE_KEY : END_SOUND_KEY, {
		name: file.name,
		data,
		mime: file.type || "audio/mpeg",
		savedAt: Date.now(),
	});
}

export async function clearCustomCallSound(kind: CallSoundKind): Promise<void> {
	await idbDelete(kind === "ringtone" ? RINGTONE_KEY : END_SOUND_KEY);
}

export async function getCustomCallSoundName(
	kind: CallSoundKind,
): Promise<string | null> {
	if (typeof indexedDB === "undefined") return null;
	try {
		const record = await idbGet(
			kind === "ringtone" ? RINGTONE_KEY : END_SOUND_KEY,
		);
		return record?.name ?? null;
	} catch {
		return null;
	}
}
