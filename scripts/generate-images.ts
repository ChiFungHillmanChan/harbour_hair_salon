/**
 * Generate salon images using Gemini 2.0 Flash (image generation preview).
 *
 * Usage:
 *   GEMINI_API_KEY=<key> npx tsx scripts/generate-images.ts
 *
 * Generates images to public/images/ for use across the site.
 */

import fs from 'fs';
import path from 'path';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('Error: GEMINI_API_KEY environment variable is required.');
  console.error('Usage: GEMINI_API_KEY=<your-key> npx tsx scripts/generate-images.ts');
  process.exit(1);
}

const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'images');

const MODEL = 'gemini-3-pro-image-preview';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

interface ImageSpec {
  filename: string;
  prompt: string;
}

const IMAGES: ImageSpec[] = [
  {
    filename: 'hero-salon.png',
    prompt:
      'Professional photograph of a premium modern hair salon interior with warm lighting. Dark walls, wooden accents, large mirrors, vintage barber chairs. Moody atmospheric lighting with warm gold tones. The space feels luxurious and intimate, inspired by upscale Hong Kong barbershops. No text, no people, no logos. Photorealistic, wide angle lens, shallow depth of field.',
  },
  {
    filename: 'services-hero.png',
    prompt:
      'Close-up professional photograph of premium hair styling tools arranged artistically on a dark marble surface. Gold scissors, combs, brushes, hair clips. Warm directional lighting creating elegant shadows. Luxury hair salon aesthetic. No text, no people, no logos. Photorealistic, overhead angle.',
  },
  {
    filename: 'offers-hero.png',
    prompt:
      'Professional photograph of an upscale hair salon styling station with a large round mirror, warm pendant lighting, and dark wood shelving with premium hair products. Gold and copper accents throughout. Empty chair facing the mirror. Moody atmospheric lighting. No text, no people, no logos. Photorealistic.',
  },
  {
    filename: 'og-image.png',
    prompt:
      'Elegant wide banner image for a premium hair salon called Harbour Hair. Dark moody interior of a luxury barbershop with warm gold lighting, vintage leather chairs, large mirrors. The atmosphere is sophisticated and modern with Hong Kong inspired design. No text, no people, no logos. Photorealistic, cinematic wide aspect ratio 1200x630.',
  },
  {
    filename: 'favicon.png',
    prompt:
      'Minimalist logo icon for a hair salon. The letter H stylised with a pair of scissors integrated into the design. Gold colour on a dark navy background. Clean geometric design, suitable for a small favicon. Square format, simple, elegant, premium feel. No text besides the letter H.',
  },
];

async function generateImage(spec: ImageSpec): Promise<void> {
  console.log(`Generating: ${spec.filename}...`);

  const body = {
    contents: [
      {
        parts: [{ text: spec.prompt }],
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  };

  try {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`  Failed (${response.status}): ${errorText.substring(0, 200)}`);
      return;
    }

    const data = await response.json();
    const candidates = data.candidates;

    if (!candidates || candidates.length === 0) {
      console.error(`  No candidates returned for ${spec.filename}`);
      return;
    }

    // Find the image part in the response
    const parts = candidates[0].content?.parts || [];
    const imagePart = parts.find(
      (p: { inlineData?: { mimeType: string; data: string } }) => p.inlineData?.mimeType?.startsWith('image/')
    );

    if (!imagePart?.inlineData) {
      console.error(`  No image data in response for ${spec.filename}`);
      console.error(`  Response parts:`, parts.map((p: Record<string, unknown>) => Object.keys(p)));
      return;
    }

    const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
    const outputPath = path.join(OUTPUT_DIR, spec.filename);
    fs.writeFileSync(outputPath, imageBuffer);
    console.log(`  Saved: ${outputPath} (${(imageBuffer.length / 1024).toFixed(0)}KB)`);
  } catch (error) {
    console.error(`  Error generating ${spec.filename}:`, error);
  }
}

async function main() {
  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log(`Output directory: ${OUTPUT_DIR}`);
  console.log(`Generating ${IMAGES.length} images...\n`);

  // Generate images sequentially to avoid rate limits
  for (const spec of IMAGES) {
    await generateImage(spec);
    // Small delay between requests
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log('\nDone. Update your components to reference /images/<filename>');
}

main();
