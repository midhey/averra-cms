import type { BlockInstance, MediaMap, PageContent } from '@averra/schema'
import { Cta } from './cta/Cta'
import { Features } from './features/Features'
import { Hero } from './hero/Hero'

type PageProps = {
  content: PageContent
  /** Картинки, на которые ссылаются блоки. Без справочника блоки выводятся без картинок */
  media?: MediaMap
}

export function Page({ content, media = {} }: PageProps) {
  // h1 на странице один: его получает первый блок «Первый экран»
  const mainHeroId = content.blocks.find((block) => block.type === 'hero')?.id
  return (
    <main>
      {content.blocks.map((block, index) => (
        <Block
          key={block.id}
          block={block}
          headingLevel={block.id === mainHeroId ? 1 : 2}
          media={media}
          // Первый блок виден сразу при открытии: его картинку не откладываем
          priority={index === 0}
        />
      ))}
    </main>
  )
}

type BlockProps = { block: BlockInstance; headingLevel: 1 | 2; media: MediaMap; priority: boolean }

function Block({ block, ...common }: BlockProps) {
  switch (block.type) {
    case 'hero':
      return <Hero id={block.id} data={block.props} {...common} />
    case 'features':
      return <Features id={block.id} data={block.props} {...common} />
    case 'cta':
      return <Cta id={block.id} data={block.props} {...common} />
    default: {
      // Появится в схеме блок без компонента — здесь будет ошибка компиляции
      const missing: never = block
      return missing
    }
  }
}
