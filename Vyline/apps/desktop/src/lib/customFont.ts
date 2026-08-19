/**
 * lib/customFont.ts — カスタムフォント（Knot の代表機能の一つ）
 *
 * ユーザーが選んだ TTF/OTF ファイルをアプリ全体のフォントとして適用する。
 * フォントバイナリは数百KB〜数MBになりうるため、Zustand の永続化 (localStorage)
 * ではなく IndexedDB に保存する。起動時に読み込んで FontFace API で適用する。
 */

const DB_NAME = "vyline-fonts";
const STORE_NAME = "custom-font";
const RECORD_KEY = "current";
const CSS_VAR = "--vy-font-family";
const FONT_FAMILY_NAME = "VylineCustomFont";

export interface CustomFontRecord {
	name: string;
	data: ArrayBuffer;
	savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME);
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
	});
}

async function idbGet(): Promise<CustomFontRecord | undefined> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readonly");
		const req = tx.objectStore(STORE_NAME).get(RECORD_KEY);
		req.onsuccess = () => resolve(req.result as CustomFontRecord | undefined);
		req.onerror = () => reject(req.error ?? new Error("indexedDB get failed"));
	});
}

async function idbSet(record: CustomFontRecord): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		tx.objectStore(STORE_NAME).put(record, RECORD_KEY);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error("indexedDB put failed"));
	});
}

async function idbClear(): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		tx.objectStore(STORE_NAME).delete(RECORD_KEY);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error("indexedDB delete failed"));
	});
}

function isFontFaceSupported(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof FontFace !== "undefined" &&
		!!document.fonts
	);
}

async function applyFontFace(data: ArrayBuffer): Promise<void> {
	if (!isFontFaceSupported()) return;
	const face = new FontFace(FONT_FAMILY_NAME, data);
	await face.load();
	document.fonts.add(face);
	const existing = getComputedStyle(document.documentElement).getPropertyValue(
		CSS_VAR,
	);
	document.documentElement.style.setProperty(
		CSS_VAR,
		`"${FONT_FAMILY_NAME}", ${existing || "sans-serif"}`,
	);
}

function resetFontFace(): void {
	document.documentElement.style.removeProperty(CSS_VAR);
}

/** 起動時に一度呼ぶ。保存済みのカスタムフォントがあれば適用する */
export async function initCustomFont(): Promise<void> {
	if (typeof indexedDB === "undefined") return;
	try {
		const record = await idbGet();
		if (record?.data) await applyFontFace(record.data);
	} catch {
		/* フォント読み込み失敗は致命的ではない（既定フォントのまま） */
	}
}

/** ファイル選択からカスタムフォントを保存・即時適用する */
export async function setCustomFontFromFile(file: File): Promise<void> {
	const data = await file.arrayBuffer();
	await applyFontFace(data); // 先に検証（不正なフォントなら例外で保存前に弾ける）
	await idbSet({ name: file.name, data, savedAt: Date.now() });
}

/** カスタムフォントを解除し既定フォントへ戻す */
export async function clearCustomFont(): Promise<void> {
	resetFontFace();
	await idbClear();
}

export async function getCustomFontName(): Promise<string | null> {
	if (typeof indexedDB === "undefined") return null;
	try {
		const record = await idbGet();
		return record?.name ?? null;
	} catch {
		return null;
	}
}
