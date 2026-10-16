/** `app/api/auth/signout/route.ts`: ends every session and clears site data. */
export const SIGN_OUT_PATH = '/api/auth/signout';

/**
 * Wipes this site's HTTP cache (signed-in pages included) and its browser
 * storage. Cookies are deliberately not on the list: that would also drop the
 * language choice, the salon kiosk's device credential and the login_device
 * cookie that stops strangers locking the owner out. The account's own cookies
 * are removed one by one instead.
 */
export const SIGN_OUT_CLEAR_SITE_DATA = '"cache", "storage"';
