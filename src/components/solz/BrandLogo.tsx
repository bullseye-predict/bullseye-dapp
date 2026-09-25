import { brand, type Brand } from './brand'

/** The brand logo, plus the wordmark as text when the image is a mark only.
 *  Header and footer both render it, so a brand switch changes one place. */
export function BrandLogo({ of = brand }: { of?: Brand }) {
  return <>
    <img src={of.logo.src} alt={of.name} width={of.logo.width} height={of.logo.height} />
    {of.logo.withWordmark && <span aria-hidden="true">{of.wordmark}</span>}
  </>
}
