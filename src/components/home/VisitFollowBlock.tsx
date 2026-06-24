import SocialLinks from '@/components/layout/SocialLinks';
import { getSiteSettings } from '@/app/services/site-settings-service';

export default async function VisitFollowBlock() {
  const settings = await getSiteSettings();
  return (
    <section className="bg-zinc-50 py-16">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="font-serif text-3xl text-brand mb-3">Visit &amp; follow us</h2>
        <p className="text-zinc-600 mb-6">
          Find us in central Leeds, book through Treatwell, or follow along on Instagram.
        </p>
        <div className="flex justify-center mb-6">
          <SocialLinks settings={settings} />
        </div>
        <div className="flex flex-wrap justify-center gap-4">
          {settings.treatwellUrl && (
            <a
              href={settings.treatwellUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="border border-accent text-brand px-6 py-3 uppercase tracking-[0.2em] text-sm font-bold hover:bg-accent hover:text-black transition-colors"
            >
              Book on Treatwell
            </a>
          )}
          {settings.googleBusinessUrl && (
            <a
              href={settings.googleBusinessUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand underline hover:text-accent transition-colors self-center"
            >
              Directions &amp; Google reviews
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
