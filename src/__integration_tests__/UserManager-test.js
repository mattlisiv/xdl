/**
 * @flow
 */

import fs from 'fs-extra';
import path from 'path';
import HashIds from 'hashids';
import uuid from 'uuid';
import ApiV2Client from '../ApiV2';
import { UserManagerInstance } from '../User';

const XDL_TEST_CLIENT_ID = 'o0YygTgKhOTdoWj10Yl9nY2P0SMTw38Y';

import type { User } from '../User';

const _makeShortId = (salt: string, minLength: number = 10): string => {
  const hashIds = new HashIds(salt, minLength);
  return hashIds.encode(Date.now());
};

describe('UserManager', () => {
  let userForTest;
  let userForTestPassword;

  beforeAll(async () => {
    process.env.__UNSAFE_EXPO_HOME_DIRECTORY = path.join(
      '/',
      'tmp',
      `.expo-${_makeShortId(uuid.v1())}`
    );

    const UserManager = _newTestUserManager();

    const username = `xdl-test-${_makeShortId(uuid.v1())}`;
    const password = uuid.v1();

    // Register a new user that we can use for this test run
    const newUser = await UserManager.registerAsync({
      username,
      password,
      email: `adam+${username}@getexponent.com`,
      givenName: 'XDL',
      familyName: 'Test User',
    });

    userForTest = newUser;
    userForTestPassword = password; // save password so we can use it to login

    await UserManager.logoutAsync(); // log us out so we're in a clean state for these tests
  });

  afterAll(async () => {
    if (process.env.__UNSAFE_EXPO_HOME_DIRECTORY) {
      fs.removeSync(process.env.__UNSAFE_EXPO_HOME_DIRECTORY);
    }

    const api = ApiV2Client.clientForUser(userForTest);
    try {
      await api.postAsync('auth/deleteUser');
    } catch (e) {
      console.error(e);
    }
  });

  it('should make available a global, shared UserManager singleton', () => {
    const { default: UserManager } = require('../User');
    expect(UserManager).toBeDefined();
    expect(UserManager.initialize).toBeDefined();
  });

  it('should not have a currently logged in user', async () => {
    const UserManager = _newTestUserManager();
    try {
      await UserManager.ensureLoggedInAsync();
    } catch (e) {
      expect(e.message).toEqual('Not logged in');
    }
  });

  it('should login successfully', async () => {
    const UserManager = _newTestUserManager();
    await UserManager.loginAsync('user-pass', {
      username: userForTest.username,
      password: userForTestPassword,
    });

    const user = await UserManager.getCurrentUserAsync();
    expect(user).not.toBeNull();
    if (!user) {
      return;
    }
    expect(user.username).toBe(userForTest.username);
    expect(user.idToken).not.toBeFalsy();
  });

  it('should use cached user after first run of getCurrentUserAsync() instead of verifying token with Auth0', async () => {
    const UserManager = _newTestUserManager();
    await UserManager.loginAsync('user-pass', {
      username: userForTest.username,
      password: userForTestPassword,
    });

    // Spy on getProfileAsync
    const _getProfileSpy = jest.fn(UserManager._getProfileAsync);
    // $FlowFixMe
    UserManager._getProfileAsync = _getProfileSpy;

    await UserManager.getCurrentUserAsync();

    expect(_getProfileSpy).not.toHaveBeenCalled();
  });

  it('should correctly use lock to prevent getting session twice, simulatenously', async () => {
    const UserManager = _newTestUserManager();
    await UserManager.loginAsync('user-pass', {
      username: userForTest.username,
      password: userForTestPassword,
    });

    UserManager._currentUser = null;

    // Spy on getProfileAsync
    const _getProfileSpy = jest.fn(UserManager._getProfileAsync);
    // $FlowFixMe
    UserManager._getProfileAsync = _getProfileSpy;

    const users = ((await Promise.all([
      UserManager.getCurrentUserAsync(),
      UserManager.getCurrentUserAsync(),
    ]): any): Array<User>);

    expect(_getProfileSpy).toHaveBeenCalledTimes(1);

    // This shouldn't have changed, but just double check it
    expect(users[0].idToken).toEqual(users[1].idToken);
    expect(users[0].refreshToken).toEqual(users[1].refreshToken);
  });

  it('should detect expired token when calling getCurrentUserAsync', async () => {
    const UserManager = _newTestUserManager();
    // Make sure we have a session
    const initialUser = await UserManager.loginAsync('user-pass', {
      username: userForTest.username,
      password: userForTestPassword,
    });
    // set the refresh session threshold to a very high value, simulating an expired token
    UserManager.refreshSessionThreshold = 63072000;

    // Spy on _auth0RefreshToken
    const _auth0RefreshTokenSpy = jest.fn(UserManager._auth0RefreshToken);
    // $FlowFixMe
    UserManager._auth0RefreshToken = _auth0RefreshTokenSpy;

    const currentUser = ((await UserManager.getCurrentUserAsync(): any): User);
    expect(_auth0RefreshTokenSpy).toBeCalled();
    expect(currentUser.idToken).not.toEqual(initialUser.idToken);
  });
});

function _newTestUserManager() {
  const UserManager = new UserManagerInstance();
  UserManager.initialize(XDL_TEST_CLIENT_ID); // XDL Test Client
  return UserManager;
}
