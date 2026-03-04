# HelpModal 元件

共用 Online Help modal，依 `url` 動態載入 Markdown 並渲染。

## Props

```ts
interface HelpModalProps {
  open: boolean
  onClose: () => void
  url?: string    // 預設 /help-sourcefile.md
  title?: string  // 預設「使用說明」
}
```

## 使用範例

```tsx
import HelpModal from '@/components/HelpModal'

const [showHelp, setShowHelp] = useState(false)

<HelpModal
  open={showHelp}
  onClose={() => setShowHelp(false)}
  url="/help-sourcefile.md"
  title="使用說明"
/>
```

## Help 檔案

- 放置於 `frontend/public/`，檔名如 `help-sourcefile.md`、`help-agent.md` 等
- 支援 Markdown（含 GFM 表格）
- Docker 部署時可 volume 掛載，改檔即生效
