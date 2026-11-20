# ストリップ勇者伝 - 3Dクロウラー放置RPG

一人称視点の疑似3Dダンジョンクロウラー（テクスチャ付きレイキャスティング＋ドット絵スプライト）と、常設の横長ストリップUI＆フローティング3窓が融合したハクスラ放置RPGです。

詳細仕様は [GAME_SPEC.md](./GAME_SPEC.md) を参照してください。

## 開発・ビルドコマンド

- 依存関係インストール: `npm install`
- 開発サーバー起動: `npm run dev`
- ユニットテスト実行: `npx tsx --test src/game/game.test.ts`
- 型チェック: `npm run lint`
- 本番ビルド: `npm run build`
