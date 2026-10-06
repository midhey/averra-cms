import type { BlockInstance, PageContent } from '@cms/schema'
import { Cta } from './cta/Cta'
import { Features } from './features/Features'
import { Hero } from './hero/Hero'

export function Page({ content }: { content: PageContent }) {
  // h1 на странице один: его получает первый блок «Первый экран»
  const mainHeroId = content.blocks.find((block) => block.type === 'hero')?.id
  return (
    <main>
      {content.blocks.map((block) => (
        <Block key={block.id} block={block} headingLevel={block.id === mainHeroId ? 1 : 2} />
      ))}
    </main>
  )
}

function Block({ block, headingLevel }: { block: BlockInstance; headingLevel: 1 | 2 }) {
  switch (block.type) {
    case 'hero':
      return <Hero id={block.id} data={block.props} headingLevel={headingLevel} />
    case 'features':
      return <Features id={block.id} data={block.props} headingLevel={headingLevel} />
    case 'cta':
      return <Cta id={block.id} data={block.props} headingLevel={headingLevel} />
    default: {
      // Появится в схеме блок без компонента — здесь будет ошибка компиляции
      const missing: never = block
      return missing
    }
  }
}
