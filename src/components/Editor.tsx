import { useEffect, useRef } from 'react'
import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import { fileToDataURL } from '../util'

interface Props {
  value: string
  onChange?: (md: string) => void
  readOnly?: boolean
}

/** 所见即所得 Markdown 编辑器：标题/列表/任务清单/表格/代码块/数学公式/图片，支持 / 斜杠菜单 与 选中浮动工具栏 */
export default function Editor({ value, onChange, readOnly }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  useEffect(() => {
    if (!root.current) return
    const crepe = new Crepe({
      root: root.current,
      defaultValue: value,
      featureConfigs: {
        // 使用浏览器原生光标：Crepe 的虚拟光标按字体测量定位，在部分系统/字体下会错位
        [Crepe.Feature.Cursor]: { virtual: false },
        [Crepe.Feature.Placeholder]: { text: '写下策略内容… 输入 / 唤出菜单', mode: 'block' },
        [Crepe.Feature.ImageBlock]: {
          onUpload: fileToDataURL,
          inlineOnUpload: fileToDataURL,
          blockOnUpload: fileToDataURL,
          inlineUploadButton: '上传',
          inlineConfirmButton: '确定',
          inlineUploadPlaceholderText: '或粘贴图片链接',
          blockUploadButton: '上传图片',
          blockConfirmButton: '确定',
          blockUploadPlaceholderText: '或粘贴图片链接',
          blockCaptionPlaceholderText: '图片说明',
        },
        [Crepe.Feature.BlockEdit]: {
          textGroup: {
            label: '文本',
            text: { label: '正文' },
            h1: { label: '一级标题' },
            h2: { label: '二级标题' },
            h3: { label: '三级标题' },
            h4: { label: '四级标题' },
            h5: { label: '五级标题' },
            h6: { label: '六级标题' },
            quote: { label: '引用' },
            divider: { label: '分割线' },
          },
          listGroup: {
            label: '列表',
            bulletList: { label: '无序列表' },
            orderedList: { label: '有序列表' },
            taskList: { label: '任务清单' },
          },
          advancedGroup: {
            label: '高级',
            image: { label: '图片' },
            codeBlock: { label: '代码块' },
            table: { label: '表格' },
            math: { label: '数学公式' },
          },
        },
      },
    })
    crepe.on((l) => {
      l.markdownUpdated((_ctx, md, prev) => {
        if (md !== prev) changeRef.current?.(md)
      })
    })
    crepe.create().then(() => { if (readOnly) crepe.setReadonly(true) })
    return () => {
      crepe.destroy()
    }
    // 只在挂载时初始化；切换策略时由外层 key 重新挂载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className={`editor ${readOnly ? 'readonly' : ''}`} ref={root} />
}
