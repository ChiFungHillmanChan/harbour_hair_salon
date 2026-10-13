import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absoluteImageUrl, isLocalImagePath } from './image-src';

test('only root-relative paths count as local images', () => {
  assert.equal(isLocalImagePath('/images/post.webp'), true);
  assert.equal(isLocalImagePath('//evil.example/x.png'), false);
  assert.equal(isLocalImagePath('https://res.cloudinary.com/demo/image/upload/x.jpg'), false);
  assert.equal(isLocalImagePath('post.webp'), false);
});

test('absoluteImageUrl prefixes local paths and leaves remote URLs alone', () => {
  const site = 'https://www.harbourhair.co.uk';
  assert.equal(absoluteImageUrl('/images/post.webp', site), 'https://www.harbourhair.co.uk/images/post.webp');
  const remote = 'https://res.cloudinary.com/demo/image/upload/x.jpg';
  assert.equal(absoluteImageUrl(remote, site), remote);
});
