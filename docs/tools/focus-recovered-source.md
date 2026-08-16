# focusRecoveredSource

全件 decompile 済みの recovered native `.c` ツリーをキーワード別に分類・再配置します。

`findNativeSymbol` が「先に絞ってから decompile」なのに対し、こちらは
「既に大量にある結果を後から整理する」用途です。

> 教育・実験目的のみ。詳細: [DISCLAIMER.md](./DISCLAIMER.md)

## 実行

```powershell
bun run focus -- --source-dir path\to\recovered\src\native\LINE.exe
bun run focus -- --manifest-only
bun run focus -- --group storage=Storage|Index
```

既定:

- source: `data/recovered/src/native/LINE.exe`
- out: `data/out/focused/`
