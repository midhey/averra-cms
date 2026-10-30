import {
  isCustomBlock,
  type MediaMap,
  mainHeadingBlock,
  type PageBlock,
  type PageContent,
} from '@averra/schema'
import { Clients } from './clients/Clients'
import { Contacts } from './contacts/Contacts'
import { Cta } from './cta/Cta'
import { CustomBlock } from './custom/CustomBlock'
import type { CustomBlockMap } from './custom/render'
import { Faq } from './faq/Faq'
import { Features } from './features/Features'
import { Form } from './form/Form'
import { Gallery } from './gallery/Gallery'
import { CONTENT_ID } from './header/view'
import { Hero } from './hero/Hero'
import { Pricing } from './pricing/Pricing'
import { Reviews } from './reviews/Reviews'
import { Stats } from './stats/Stats'
import { Steps } from './steps/Steps'
import { Team } from './team/Team'
import { Text } from './text/Text'
import { TextImage } from './text-image/TextImage'
import { Video } from './video/Video'

type PageProps = {
  content: PageContent
  /** Картинки, на которые ссылаются блоки. Без справочника блоки выводятся без картинок */
  media?: MediaMap
  /** Адрес приёма заявок формы по id блока. Без него (предпросмотр) формы не отправляются */
  formAction?: (blockId: string) => string
  /** Опубликованные свои блоки по ключу. Без них свои блоки страницы не выводятся */
  customBlocks?: CustomBlockMap
  /**
   * Свой блок не вывелся (данные не подходят под определение, шаблон упал): сборка пишет это в
   * журнал. Без него — молча, как на сайте
   */
  onCustomBlockError?: (blockId: string, message: string) => void
  /** Предпросмотр в админке: вместо невыведенного своего блока — причина на его месте */
  preview?: boolean
}

export function Page({
  content,
  media = {},
  formAction,
  customBlocks = {},
  onCustomBlockError,
  preview = false,
}: PageProps) {
  // h1 на странице один: его получает первый блок «Первый экран». Правило — в схеме: по нему же
  // проверки SEO в редакторе говорят, есть ли h1
  const mainHeroId = mainHeadingBlock(content.blocks)?.id
  const pageIds = content.blocks.map((block) => block.id)
  return (
    // id — цель «К содержимому» в шапке сайта (SiteHeader)
    <main id={CONTENT_ID}>
      {content.blocks.map((block, index) => (
        <Block
          key={block.id}
          block={block}
          headingLevel={block.id === mainHeroId ? 1 : 2}
          media={media}
          formAction={formAction}
          customBlocks={customBlocks}
          onCustomBlockError={onCustomBlockError}
          preview={preview}
          pageIds={pageIds}
          // Первый блок виден сразу при открытии: его картинку не откладываем
          priority={index === 0}
        />
      ))}
    </main>
  )
}

type BlockProps = {
  block: PageBlock
  headingLevel: 1 | 2
  media: MediaMap
  priority: boolean
  formAction?: ((blockId: string) => string) | undefined
  customBlocks: CustomBlockMap
  onCustomBlockError?: ((blockId: string, message: string) => void) | undefined
  preview: boolean
  pageIds: readonly string[]
}

function Block({
  block,
  customBlocks,
  onCustomBlockError,
  preview,
  pageIds,
  ...common
}: BlockProps) {
  if (isCustomBlock(block)) {
    return (
      <CustomBlock
        block={block}
        definitions={customBlocks}
        media={common.media}
        priority={common.priority}
        onError={onCustomBlockError}
        preview={preview}
        pageIds={pageIds}
      />
    )
  }
  switch (block.type) {
    case 'hero':
      return <Hero id={block.id} data={block.props} {...common} />
    case 'text-image':
      return <TextImage id={block.id} data={block.props} {...common} />
    case 'features':
      return <Features id={block.id} data={block.props} {...common} />
    case 'stats':
      return <Stats id={block.id} data={block.props} {...common} />
    case 'steps':
      return <Steps id={block.id} data={block.props} {...common} />
    case 'pricing':
      return <Pricing id={block.id} data={block.props} {...common} />
    case 'gallery':
      return <Gallery id={block.id} data={block.props} {...common} />
    case 'reviews':
      return <Reviews id={block.id} data={block.props} {...common} />
    case 'clients':
      return <Clients id={block.id} data={block.props} {...common} />
    case 'team':
      return <Team id={block.id} data={block.props} {...common} />
    case 'faq':
      return <Faq id={block.id} data={block.props} {...common} />
    case 'text':
      return <Text id={block.id} data={block.props} {...common} />
    case 'video':
      return <Video id={block.id} data={block.props} {...common} />
    case 'cta':
      return <Cta id={block.id} data={block.props} {...common} />
    case 'form':
      return <Form id={block.id} data={block.props} {...common} />
    case 'contacts':
      return <Contacts id={block.id} data={block.props} {...common} />
    default: {
      // Появится в схеме блок без компонента — здесь будет ошибка компиляции
      const missing: never = block
      return missing
    }
  }
}
