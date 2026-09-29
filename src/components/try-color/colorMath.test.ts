import test from 'node:test';
import assert from 'node:assert/strict';

import { PRESET_COLORS, buildCustomShadePreset, type HairConsultation } from './constants';
import { refineHairMask, type HairMaskData } from './HairSegmentation';
import {
  analyzeHair,
  applyRecolorToImageDataWithAlpha,
  hexToLinearRgb,
  linearRgbToRgb,
  resolveRecolorContext,
  smoothHairAnalysis,
  rgbToLab,
} from './colorMath';

function perceivedLuminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function createSolidImageData(
  colors: Array<[number, number, number]>,
  alphaMask?: number[],
  dims?: { width: number; height: number },
): { imageData: ImageData; mask: Float32Array } {
  const data = new Uint8ClampedArray(colors.length * 4);

  colors.forEach(([r, g, b], index) => {
    const offset = index * 4;
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = 255;
  });

  return {
    imageData: {
      data,
      width: dims?.width ?? colors.length,
      height: dims?.height ?? 1,
    } as ImageData,
    mask: new Float32Array(alphaMask ?? new Array(colors.length).fill(1)),
  };
}

function createHairMaskData(
  imageData: ImageData,
  alphaMask?: number[],
  coreMask?: number[],
  fringeMask?: number[],
): HairMaskData {
  const size = imageData.width * imageData.height;
  const alpha = new Float32Array(alphaMask ?? new Array(size).fill(1));
  return {
    alphaMask: alpha,
    coreMask: new Float32Array(coreMask ?? Array.from(alpha, (value) => (value >= 0.6 ? value : 0))),
    fringeMask: new Float32Array(fringeMask ?? Array.from(alpha, (value) => (value > 0 && value < 0.6 ? value : 0))),
    width: imageData.width,
    height: imageData.height,
  };
}

test('linear sRGB round-trip stays within one code value', () => {
  const rgb = linearRgbToRgb(hexToLinearRgb('#b87333'));
  assert.ok(Math.abs(rgb[0] - 184) <= 1);
  assert.ok(Math.abs(rgb[1] - 115) <= 1);
  assert.ok(Math.abs(rgb[2] - 51) <= 1);
});

test('hair analysis maps dark and light samples to expected levels', () => {
  const darkSample = createSolidImageData([[22, 15, 10]]);
  const lightSample = createSolidImageData([[231, 219, 198]]);

  const darkAnalysis = analyzeHair(darkSample.imageData, darkSample.mask);
  const lightAnalysis = analyzeHair(lightSample.imageData, lightSample.mask);

  assert.ok(darkAnalysis.estimatedBaseLevel <= 2);
  assert.ok(lightAnalysis.estimatedBaseLevel >= 9);
});

test('default deposit can darken but cannot lift for any preset mode', () => {
  const analysis = {
    meanLuminance: 0.28,
    p95Luminance: 0.36,
    chroma: 0.18,
    warmCoolBias: 0.1,
    estimatedBaseLevel: 5 as const,
    confidence: 1,
  };

  const black = PRESET_COLORS.find((preset) => preset.name === 'Natural Black');
  const copper = PRESET_COLORS.find((preset) => preset.name === 'Copper');
  const platinum = PRESET_COLORS.find((preset) => preset.name === 'Platinum Blonde');

  assert.ok(black);
  assert.ok(copper);
  assert.ok(platinum);

  const deposit = resolveRecolorContext(
    { preset: black!, previewStrength: 70, baseLevelMode: 'auto' },
    analysis,
  );
  const tone = resolveRecolorContext(
    { preset: copper!, previewStrength: 70, baseLevelMode: 'auto' },
    analysis,
  );
  const lift = resolveRecolorContext(
    { preset: platinum!, previewStrength: 70, baseLevelMode: 'auto' },
    analysis,
  );

  assert.equal(deposit.achievedLevel, 1);
  assert.equal(tone.achievedLevel, 4);
  assert.equal(lift.achievedLevel, 5);
  assert.equal(lift.constrained, true);
});

test('manual base level override wins over auto estimate', () => {
  const platinum = PRESET_COLORS.find((preset) => preset.name === 'Platinum Blonde');
  assert.ok(platinum);

  const analysis = {
    meanLuminance: 0.18,
    p95Luminance: 0.24,
    chroma: 0.12,
    warmCoolBias: 0.15,
    estimatedBaseLevel: 4 as const,
    confidence: 1,
  };

  const resolved = resolveRecolorContext(
    {
      preset: platinum!,
      previewStrength: 70,
      baseLevelMode: 'manual',
      manualBaseLevel: 7,
    },
    analysis,
  );

  assert.equal(resolved.effectiveBaseLevel, 7);
  assert.equal(resolved.achievedLevel, 7);
});

test('unrealistic lift shows pre-lightening guidance', () => {
  const platinum = PRESET_COLORS.find((preset) => preset.name === 'Platinum Blonde');
  assert.ok(platinum);

  const analysis = {
    meanLuminance: 0.1,
    p95Luminance: 0.16,
    chroma: 0.1,
    warmCoolBias: 0.25,
    estimatedBaseLevel: 2 as const,
    confidence: 1,
  };

  const resolved = resolveRecolorContext(
    { preset: platinum!, previewStrength: 70, baseLevelMode: 'auto' },
    analysis,
  );

  assert.equal(resolved.achievedLevel, 2);
  assert.ok(resolved.notices.includes('needs-lightening'));
});

test('highlight preservation reduces recolor intensity on brightest pixels', () => {
  const caramel = PRESET_COLORS.find((preset) => preset.name === 'Caramel');
  assert.ok(caramel);

  const { imageData, mask } = createSolidImageData([
    [245, 230, 210],
    [110, 85, 60],
  ]);
  const hairMask = createHairMaskData(imageData, Array.from(mask));
  const before = new Uint8ClampedArray(imageData.data);

  applyRecolorToImageDataWithAlpha(imageData, hairMask, {
    preset: caramel!,
    previewStrength: 90,
    baseLevelMode: 'manual',
    manualBaseLevel: 5,
  });

  const brightBeforeLum = perceivedLuminance(before[0], before[1], before[2]);
  const brightAfterLum = perceivedLuminance(
    imageData.data[0],
    imageData.data[1],
    imageData.data[2],
  );
  const shadowDelta =
    Math.abs(imageData.data[4] - before[4]) +
    Math.abs(imageData.data[5] - before[5]) +
    Math.abs(imageData.data[6] - before[6]);

  assert.ok(brightAfterLum >= brightBeforeLum * 0.9);
  assert.ok(shadowDelta > 0);
});

test('mask refinement fills pinholes and produces both core and fringe masks', () => {
  const { imageData } = createSolidImageData([
    [120, 90, 60],
    [125, 95, 63],
    [130, 100, 66],
    [135, 105, 69],
    [140, 110, 72],
    [145, 115, 75],
    [150, 120, 78],
    [155, 125, 81],
    [160, 130, 84],
  ], undefined, { width: 3, height: 3 });
  const rawMask = new Float32Array([
    0.72, 0.7, 0.68,
    0.7, 0.02, 0.45,
    0.66, 0.5, 0.18,
  ]);

  const refined = refineHairMask(imageData, rawMask);

  assert.ok(refined.alphaMask[4] > rawMask[4]);
  assert.ok(refined.coreMask.some((value) => value > 0));
  assert.ok(refined.fringeMask.some((value) => value > 0));
});

test('fringe pixels recolor less than core pixels for the same preset', () => {
  const copper = PRESET_COLORS.find((preset) => preset.name === 'Copper');
  assert.ok(copper);

  const { imageData } = createSolidImageData([
    [135, 105, 80],
    [135, 105, 80],
    [135, 105, 80],
  ]);
  const before = new Uint8ClampedArray(imageData.data);
  const hairMask = createHairMaskData(
    imageData,
    [1, 1, 0.45],
    [1, 1, 0],
    [0, 0, 1],
  );

  applyRecolorToImageDataWithAlpha(imageData, hairMask, {
    preset: copper!,
    previewStrength: 90,
    baseLevelMode: 'manual',
    manualBaseLevel: 5,
  });

  const coreWarmShift = (imageData.data[0] - imageData.data[2]) - (before[0] - before[2]);
  const fringeWarmShift = (imageData.data[8] - imageData.data[10]) - (before[8] - before[10]);
  const sourceLum = perceivedLuminance(before[0], before[1], before[2]);
  const fringeLum = perceivedLuminance(imageData.data[8], imageData.data[9], imageData.data[10]);
  const coreLum = perceivedLuminance(imageData.data[0], imageData.data[1], imageData.data[2]);

  assert.ok(fringeWarmShift < coreWarmShift);
  assert.ok(Math.abs(fringeLum - sourceLum) <= Math.abs(coreLum - sourceLum) + 1);
});

test('shadow protection preserves more original color in dark regions than mid regions', () => {
  const caramel = PRESET_COLORS.find((preset) => preset.name === 'Caramel');
  assert.ok(caramel);

  const { imageData } = createSolidImageData([
    [45, 30, 20],
    [155, 120, 88],
    [245, 230, 210],
  ]);
  const before = new Uint8ClampedArray(imageData.data);
  const hairMask = createHairMaskData(imageData);

  applyRecolorToImageDataWithAlpha(imageData, hairMask, {
    preset: caramel!,
    previewStrength: 90,
    baseLevelMode: 'manual',
    manualBaseLevel: 5,
  });

  const darkDelta =
    Math.abs(imageData.data[0] - before[0]) +
    Math.abs(imageData.data[1] - before[1]) +
    Math.abs(imageData.data[2] - before[2]);
  const midDelta =
    Math.abs(imageData.data[4] - before[4]) +
    Math.abs(imageData.data[5] - before[5]) +
    Math.abs(imageData.data[6] - before[6]);

  assert.ok(darkDelta < midDelta);
});

test('identical upper and lower pixels are not treated as detected roots', () => {
  const golden = PRESET_COLORS.find((preset) => preset.name === 'Golden Blonde');
  assert.ok(golden);

  const { imageData } = createSolidImageData([
    [125, 95, 70],
    [125, 95, 70],
    [125, 95, 70],
    [125, 95, 70],
  ], undefined, { width: 2, height: 2 });
  const before = new Uint8ClampedArray(imageData.data);
  const hairMask = createHairMaskData(imageData, [1, 1, 1, 1], [1, 1, 1, 1]);

  applyRecolorToImageDataWithAlpha(imageData, hairMask, {
    preset: golden!,
    previewStrength: 85,
    baseLevelMode: 'manual',
    manualBaseLevel: 5,
  });

  const topDelta =
    Math.abs(imageData.data[0] - before[0]) +
    Math.abs(imageData.data[1] - before[1]) +
    Math.abs(imageData.data[2] - before[2]);
  const bottomDelta =
    Math.abs(imageData.data[8] - before[8]) +
    Math.abs(imageData.data[9] - before[9]) +
    Math.abs(imageData.data[10] - before[10]);

  assert.equal(topDelta, bottomDelta);
});

test('legacy post-bleach does not silently assume a pale starting base', () => {
  const sample = createSolidImageData([[85, 65, 48]]);
  const resolved = resolveRecolorContext({
    preset: PRESET_COLORS.find((p) => p.name === 'Platinum Blonde')!,
    previewStrength: 100, baseLevelMode: 'manual', manualBaseLevel: 2, bleachState: 'post',
  }, analyzeHair(sample.imageData, sample.mask));
  assert.equal(resolved.achievedLevel, 2);
  assert.equal(resolved.constrained, true);
  assert.ok(resolved.notices.includes('needs-lightening'));
});

test('pre-bleach mutes a vivid cool target on dark hair (deposit reality)', () => {
  const blue = PRESET_COLORS.find((p) => p.name === 'Blue');
  assert.ok(blue);
  const { imageData, mask } = createSolidImageData([[30, 22, 16]]);
  const hairMask = createHairMaskData(imageData, Array.from(mask));
  applyRecolorToImageDataWithAlpha(imageData, hairMask, {
    preset: blue!, previewStrength: 100, baseLevelMode: 'manual', manualBaseLevel: 2, bleachState: 'pre',
  });
  const [r, g, b] = [imageData.data[0], imageData.data[1], imageData.data[2]];
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  assert.ok(chroma < 50, `expected muted chroma on dark hair, got ${chroma}`);
  assert.ok(lum < 90, `expected result to stay dark, got ${lum}`);
});

const consultation: HairConsultation = {
  treatment: 'deposit', history: 'unknown', lightenedBase: 'current', greyCoverage: 'unknown',
};

function renderSample(colors: Array<[number, number, number]>, options: Partial<HairConsultation> = {}, strength = 100) {
  const { imageData } = createSolidImageData(colors);
  const before = new Uint8ClampedArray(imageData.data);
  const context = applyRecolorToImageDataWithAlpha(imageData, createHairMaskData(imageData), {
    preset: PRESET_COLORS.find((p) => p.name === 'Ash Blonde')!, previewStrength: strength,
    baseLevelMode: 'manual', manualBaseLevel: 3, consultation: { ...consultation, ...options },
  });
  return { before, imageData, context };
}

test('zero preview strength preserves every colour and alpha byte exactly', () => {
  const { before, imageData } = renderSample([[38, 24, 12], [120, 85, 45], [248, 243, 237]], {}, 0);
  assert.deepEqual(imageData.data, before);
});

test('empty or only low-confidence masks are unusable, never an invented level five', () => {
  for (const weights of [[0, 0], [0.15, 0.2]]) {
    const sample = createSolidImageData([[120, 90, 60], [150, 130, 90]], weights);
    const analysis = analyzeHair(sample.imageData, sample.mask);
    assert.equal(analysis.quality, 'unusable');
    assert.ok(analysis.issues?.includes('no-hair'));
    assert.equal(analysis.confidence, 0);
    assert.equal(analysis.lab, undefined);
  }
});

test('unusable exposure leaves pixels untouched even with a hypothetical base and manual level', () => {
  for (const [pixel, issue] of [
    [[2, 2, 2], 'too-dark'], [[255, 255, 255], 'overexposed'],
  ] as const) {
    const { before, imageData, context } = renderSample([[...pixel]], {
      treatment: 'prelighten', lightenedBase: 'pale-yellow',
    });
    assert.equal(context.analysis.quality, 'unusable');
    assert.ok(context.analysis.issues?.includes(issue));
    assert.ok(context.notices.includes('photo-unreliable'));
    assert.deepEqual(imageData.data, before);
  }
});

test('highlights and soft mask edges do not dominate the estimated hair colour', () => {
  const clean = createSolidImageData(Array.from({ length: 100 }, () => [110, 80, 50]));
  const contaminated = createSolidImageData([
    ...Array.from({ length: 90 }, () => [110, 80, 50] as [number, number, number]),
    ...Array.from({ length: 10 }, () => [255, 255, 255] as [number, number, number]),
    ...Array.from({ length: 50 }, () => [255, 255, 255] as [number, number, number]),
  ], [...Array(100).fill(1), ...Array(50).fill(0.25)]);
  const baseline = analyzeHair(clean.imageData, clean.mask);
  const robust = analyzeHair(contaminated.imageData, contaminated.mask);
  assert.equal(robust.estimatedBaseLevel, baseline.estimatedBaseLevel);
  assert.ok(Math.abs(robust.meanLuminance - baseline.meanLuminance) < 0.01);
});

test('mixed hair reports a range and spatial regions without calling them roots', () => {
  const colors: Array<[number, number, number]> = [
    ...Array.from({ length: 12 }, () => [70, 50, 30] as [number, number, number]),
    ...Array.from({ length: 12 }, () => [155, 125, 85] as [number, number, number]),
    ...Array.from({ length: 12 }, () => [220, 205, 160] as [number, number, number]),
  ];
  const sample = createSolidImageData(colors, undefined, { width: 6, height: 6 });
  const analysis = analyzeHair(sample.imageData, sample.mask);
  assert.equal(analysis.quality, 'limited');
  assert.ok(analysis.issues?.includes('uneven-colour'));
  assert.deepEqual(analysis.regions?.map((region) => region.position), ['upper', 'middle', 'lower']);
  assert.ok(analysis.levelRange && analysis.levelRange[1] > analysis.levelRange[0]);
  assert.ok(analysis.lab && Number.isFinite(analysis.lab.l));
});

test('smoothing never hides the current frame quality failure or drops region metadata', () => {
  const good = createSolidImageData([[120, 85, 45]]);
  const empty = createSolidImageData([[120, 85, 45]], [0]);
  const previous = analyzeHair(good.imageData, good.mask);
  const next = analyzeHair(empty.imageData, empty.mask);
  assert.equal(smoothHairAnalysis(previous, next, 0.1).quality, 'unusable');
  const recovered = smoothHairAnalysis(next, previous, 0.1);
  assert.deepEqual(recovered, previous);
});

test('permanent colour only models modest illustrative lift on confirmed natural hair', () => {
  const natural = renderSample([[110, 80, 50]], { treatment: 'permanent', history: 'natural' }).context;
  assert.ok(natural.achievedLevel > 3 && natural.achievedLevel <= 5);
  for (const history of ['unknown', 'coloured', 'lightened'] as const) {
    const result = renderSample([[110, 80, 50]], { treatment: 'permanent', history }).context;
    assert.equal(result.achievedLevel, 3);
    assert.ok(result.notices.includes('needs-lightening'));
    if (history === 'unknown') assert.ok(result.notices.includes('history-unknown'));
    if (history === 'coloured') assert.ok(result.notices.includes('previous-colour'));
  }
});

test('pre-lightening keeps current-base limits until a hypothetical base is explicitly selected', () => {
  const current = renderSample([[110, 80, 50]], { treatment: 'prelighten' }).context;
  assert.equal(current.achievedLevel, 3);
  assert.ok(current.notices.includes('needs-lightening'));
  const orange = renderSample([[110, 80, 50]], { treatment: 'prelighten', lightenedBase: 'orange' });
  const pale = renderSample([[110, 80, 50]], { treatment: 'prelighten', lightenedBase: 'pale-yellow' });
  assert.ok(orange.context.achievedLevel < pale.context.achievedLevel);
  assert.ok(orange.context.notices.includes('lightened-base-assumed'));
  assert.ok(orange.context.notices.includes('warm-base'));
  assert.ok(pale.context.notices.includes('lightened-base-assumed'));
  assert.notDeepEqual(orange.imageData.data, pale.imageData.data);
  const orangeWarmth = orange.imageData.data[0] - orange.imageData.data[2];
  const paleWarmth = pale.imageData.data[0] - pale.imageData.data[2];
  assert.ok(orangeWarmth > paleWarmth, `orange warmth ${orangeWarmth} must exceed pale warmth ${paleWarmth}`);
});

test('deposit never brightens hair pixels merely because the requested shade is lighter', () => {
  const colors: Array<[number, number, number]> = [[65, 40, 22], [125, 95, 55], [200, 180, 140]];
  const { before, imageData, context } = renderSample(colors);
  assert.equal(context.achievedLevel, 3);
  assert.ok(context.notices.includes('deposit-limit'));
  for (let i = 0; i < colors.length; i++) {
    const at = i * 4;
    const beforeLum = perceivedLuminance(before[at], before[at + 1], before[at + 2]);
    const afterLum = perceivedLuminance(imageData.data[at], imageData.data[at + 1], imageData.data[at + 2]);
    assert.ok(afterLum <= beforeLum + 1, `pixel ${i}: ${afterLum} > ${beforeLum}`);
  }
});

test('unattainable lighter requests warn even when the preset is not a lift preset', () => {
  const sample = createSolidImageData([[100, 70, 40]]);
  for (const preset of PRESET_COLORS.filter((preset) => preset.targetLevel > 1)) {
    const context = resolveRecolorContext({
      preset, previewStrength: 70, baseLevelMode: 'manual', manualBaseLevel: 1, consultation,
    }, analyzeHair(sample.imageData, sample.mask));
    assert.equal(context.achievedLevel, 1, preset.name);
    assert.ok(context.notices.includes('needs-lightening'), preset.name);
    assert.ok(context.notices.includes('uncalibrated'), preset.name);
  }
});

test('matching custom HEX and a preset have identical rendering and achieved levels', () => {
  for (const preset of PRESET_COLORS) {
    const direct = createSolidImageData([[110, 80, 50], [165, 145, 115]]).imageData;
    const custom = createSolidImageData([[110, 80, 50], [165, 145, 115]]).imageData;
    const request = { preset, previewStrength: 75, baseLevelMode: 'auto' as const, consultation };
    const directContext = applyRecolorToImageDataWithAlpha(direct, createHairMaskData(direct), request);
    const customContext = applyRecolorToImageDataWithAlpha(custom, createHairMaskData(custom), {
      ...request, preset: buildCustomShadePreset(preset.swatchHex.toUpperCase()),
    });
    assert.deepEqual(custom.data, direct.data, preset.name);
    assert.equal(customContext.achievedLevel, directContext.achievedLevel, preset.name);
  }
});


test('D65 Lab conversion preserves neutral axes and known sRGB red reference', () => {
  const white = rgbToLab(255, 255, 255);
  assert.ok(Math.abs(white.l - 100) < 0.001);
  assert.ok(Math.abs(white.a) < 0.001 && Math.abs(white.b) < 0.001);
  assert.deepEqual(rgbToLab(0, 0, 0), { l: 0, a: 0, b: 0 });
  const red = rgbToLab(255, 0, 0);
  assert.ok(Math.abs(red.l - 53.237) < 0.01);
  assert.ok(Math.abs(red.a - 80.09) < 0.01);
  assert.ok(Math.abs(red.b - 67.203) < 0.01);
});

test('uneven tone is reported even when hair colours have similar depth', () => {
  const sample = createSolidImageData([
    ...Array.from({ length: 30 }, () => [150, 60, 30] as [number, number, number]),
    ...Array.from({ length: 30 }, () => [35, 99, 120] as [number, number, number]),
  ]);
  const analysis = analyzeHair(sample.imageData, sample.mask);
  assert.ok(analysis.issues?.includes('uneven-colour'));
  assert.equal(analysis.quality, 'limited');
});

test('permanent darker targets do not brighten a dark photograph under a manual override', () => {
  const sample = createSolidImageData([[40, 30, 20]]);
  const original = new Uint8ClampedArray(sample.imageData.data);
  const context = applyRecolorToImageDataWithAlpha(sample.imageData, createHairMaskData(sample.imageData), {
    preset: PRESET_COLORS.find((p) => p.name === 'Dark Brown')!,
    previewStrength: 100, baseLevelMode: 'manual', manualBaseLevel: 5,
    consultation: { ...consultation, treatment: 'permanent', history: 'natural' },
  });
  assert.equal(context.achievedLevel, 1);
  const after = sample.imageData.data;
  assert.ok(perceivedLuminance(after[0], after[1], after[2]) <= perceivedLuminance(original[0], original[1], original[2]) + 1);
});

test('near-black hair is limited rather than rejected when the rest of the photo is exposed', () => {
  const sample = createSolidImageData([
    [2, 2, 2], [2, 2, 2], [2, 2, 2], [180, 165, 145], [180, 165, 145],
  ], [1, 1, 1, 0, 0]);
  const analysis = analyzeHair(sample.imageData, sample.mask);
  assert.equal(analysis.quality, 'limited');
  assert.ok(analysis.issues?.includes('too-dark'));
  assert.equal(analysis.estimatedBaseLevel, 1);
});

test('isolated hair-mask pixels in a full image are unusable rather than a confident hair estimate', () => {
  const sample = createSolidImageData(Array.from({ length: 4096 }, () => [120, 90, 65]),
    Array(4096).fill(0), { width: 64, height: 64 });
  for (let y = 30; y < 33; y++) {
    for (let x = 30; x < 33; x++) sample.mask[y * 64 + x] = 1;
  }
  const analysis = analyzeHair(sample.imageData, sample.mask);
  assert.equal(analysis.quality, 'unusable');
  assert.ok(analysis.issues?.includes('no-hair'));
});

test('small but coherent hair regions expose limited image support in context', () => {
  const sample = createSolidImageData(Array.from({ length: 16384 }, () => [120, 90, 65]),
    Array(16384).fill(0), { width: 128, height: 128 });
  for (let y = 50; y < 60; y++) {
    for (let x = 50; x < 60; x++) sample.mask[y * 128 + x] = 1;
  }
  const analysis = analyzeHair(sample.imageData, sample.mask);
  assert.equal(analysis.quality, 'limited');
  const context = resolveRecolorContext({
    preset: PRESET_COLORS[0], previewStrength: 70, baseLevelMode: 'auto', consultation,
  }, analysis);
  assert.ok(context.notices.includes('photo-unreliable'));
});

test('adjacent custom HEX values keep the preset depth and preview continuous', () => {
  for (const name of ['Blue', 'Ash Blonde', 'Copper', 'Platinum Blonde']) {
    const preset = PRESET_COLORS.find((p) => p.name === name)!;
    const adjacentHex = `#${(parseInt(preset.swatchHex.slice(1), 16) + 1).toString(16).padStart(6, '0')}`;
    const adjacent = buildCustomShadePreset(adjacentHex);
    assert.ok(Math.abs(adjacent.targetLevel - preset.targetLevel) <= 1, `${name}: adjacent depth changed by several levels`);
    for (const treatment of ['deposit', 'permanent', 'prelighten'] as const) {
      const direct = createSolidImageData([[110, 80, 50], [165, 145, 115]]).imageData;
      const custom = createSolidImageData([[110, 80, 50], [165, 145, 115]]).imageData;
      const request = {
        preset, previewStrength: 100, baseLevelMode: 'manual' as const, manualBaseLevel: 4 as const,
        consultation: { ...consultation, history: 'natural' as const, treatment, lightenedBase: 'pale-yellow' as const },
      };
      applyRecolorToImageDataWithAlpha(direct, createHairMaskData(direct), request);
      applyRecolorToImageDataWithAlpha(custom, createHairMaskData(custom), { ...request, preset: adjacent });
      const maximumDifference = Math.max(...custom.data.map((value, index) => Math.abs(value - direct.data[index])));
      assert.ok(maximumDifference <= 2, `${name}/${treatment}: one-code-value change produced a ${maximumDifference}-value preview jump`);
    }
  }
});

test('rounding generic depth labels does not cause a brightness step between nearby custom colours', () => {
  const darker = createSolidImageData([[110, 80, 50]]).imageData;
  const lighter = createSolidImageData([[110, 80, 50]]).imageData;
  const request = {
    preset: buildCustomShadePreset('#727272'), previewStrength: 100,
    baseLevelMode: 'manual' as const, manualBaseLevel: 5 as const, consultation,
  };
  applyRecolorToImageDataWithAlpha(darker, createHairMaskData(darker), request);
  applyRecolorToImageDataWithAlpha(lighter, createHairMaskData(lighter), {
    ...request, preset: buildCustomShadePreset('#737373'),
  });
  const maximumDifference = Math.max(...lighter.data.map((value, index) => Math.abs(value - darker.data[index])));
  assert.ok(maximumDifference <= 2, `one-code-value change produced a ${maximumDifference}-value brightness jump`);
});

test('permanent warm pigment appears smoothly as a target crosses the first depth midpoint', () => {
  const darker = createSolidImageData([[110, 80, 50]]).imageData;
  const lighter = createSolidImageData([[110, 80, 50]]).imageData;
  const request = {
    preset: buildCustomShadePreset('#525252'), previewStrength: 100,
    baseLevelMode: 'manual' as const, manualBaseLevel: 1 as const,
    consultation: { ...consultation, treatment: 'permanent' as const, history: 'natural' as const },
  };
  applyRecolorToImageDataWithAlpha(darker, createHairMaskData(darker), request);
  applyRecolorToImageDataWithAlpha(lighter, createHairMaskData(lighter), {
    ...request, preset: buildCustomShadePreset('#535353'),
  });
  const maximumDifference = Math.max(...lighter.data.map((value, index) => Math.abs(value - darker.data[index])));
  assert.ok(maximumDifference <= 3, `adjacent greys produced a ${maximumDifference}-value warm-pigment jump`);
});
