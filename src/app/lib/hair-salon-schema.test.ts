import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHairSalonSchema } from './hair-salon-schema';

test('local business markup follows the published phone and profile settings', () => {
  const schema = buildHairSalonSchema(
    { phone: '020 7946 0000', googleBusinessUrl: 'https://maps.google.com/example' },
    { locale: 'en-GB', description: 'Hair styling in Leeds city centre.', sameAs: ['https://www.instagram.com/example/'] },
  );

  assert.equal(schema.telephone, '+442079460000');
  assert.equal(schema.hasMap, 'https://maps.google.com/example');
  assert.deepEqual(schema.sameAs, ['https://www.instagram.com/example/']);
  assert.equal(schema.description, 'Hair styling in Leeds city centre.');
  assert.equal(schema.address.postalCode, 'LS1 6DX');
  assert.ok(schema.address.streetAddress.includes('Upper Floor, Unit 15'));
  assert.equal(schema.openingHoursSpecification[0].opens, '10:00');
  assert.equal(schema.openingHoursSpecification[0].closes, '19:00');
});

test('both languages describe the same salon without inventing missing business data', () => {
  const settings = { phone: '+44 7831 830898', googleBusinessUrl: '' };
  const english = buildHairSalonSchema(settings, { locale: 'en-GB', description: 'English description', sameAs: [] });
  const chinese = buildHairSalonSchema(settings, { locale: 'zh-HK', description: '中文簡介', sameAs: [] });

  assert.equal(english['@id'], `${english.url}/#salon`);
  assert.equal(chinese['@id'], english['@id']);
  assert.equal(chinese.inLanguage, 'zh-HK');
  assert.equal(chinese.description, '中文簡介');
  assert.equal(chinese.telephone, '+447831830898');
  assert.equal('hasMap' in chinese, false);
  assert.equal('aggregateRating' in chinese, false);
  assert.equal('priceRange' in chinese, false);
});
