const { test } = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');

test('saving a profile change does not rehash an unchanged password', async () => {
  const user = new User({
    name: 'Test User',
    email: 'test+tag@example.technology',
    password: 'original-password'
  });
  const runSaveHooks = () =>
    new Promise((resolve, reject) => {
      User.schema.s.hooks.execPre('save', user, [], (error) =>
        error ? reject(error) : resolve()
      );
    });
  await runSaveHooks();
  assert.equal(await user.matchPassword('original-password'), true);
  const originalHash = user.password;
  user.unmarkModified('password');
  user.name = 'Updated Profile';
  await runSaveHooks();
  assert.equal(user.password, originalHash);
  assert.equal(await user.matchPassword('original-password'), true);
});
