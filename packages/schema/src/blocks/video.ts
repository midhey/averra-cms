import { z } from 'zod'
import { defineBlock } from '../define-block'
import { Image } from '../media'
import { VideoUrl } from '../video'

export const video = defineBlock({
  type: 'video',
  title: 'Видео',
  description:
    'Ролик с YouTube, Rutube или VK Видео: обложка на странице, плеер включается по клику',
  props: z.strictObject({
    url: VideoUrl.meta({
      title: 'Ссылка на ролик',
      description:
        'YouTube, Rutube или VK Видео — из адресной строки или кнопки «Поделиться». Если ролик VK не играет на сайте, вставьте адрес из его кода для вставки (src)',
    }),
    title: z.string().trim().min(1).max(120).meta({
      title: 'Заголовок',
      description: 'Над роликом; его же прочтёт экранный диктор у кнопки запуска',
    }),
    caption: z.string().trim().max(300).optional().meta({ title: 'Подпись под роликом' }),
    cover: Image.optional().meta({
      title: 'Обложка',
      description:
        'Своя картинка, лучше 16 : 9. Без неё — заглушка в цветах сайта: обложку площадки страница не грузит, чтобы не обращаться к ней до клика',
    }),
  }),
  example: {
    url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    title: 'Как мы работаем',
  },
})
