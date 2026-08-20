import { type Device } from "../core/utils/devices.js";
import type * as LINETypes from "@vyline/line-types";
import { Buffer } from "node:buffer";
import type { BaseClient } from "../core/mod.js";
import type { LooseType } from "@vyline/loose-types";
import { type AuthTokenInput } from "../request/auth_token.js";
export type LoginOption = PasswordLoginOption | QrCodeLoginOption | {
    authToken: AuthTokenInput;
    email?: undefined;
    qr?: undefined;
};
export declare function registrationAuthEndpoint(device: Device): "/api/v3p/rs" | "/api/v4p/rs";
export interface PasswordLoginOption {
    /**
     * account e-mail address
     */
    email: string;
    /**
     * account password
     */
    password: string;
    /**
     * Custom pin-code. It have to be 6-digit.
     */
    pincode?: string;
    /**
     * use v3 login or not.
     */
    v3?: boolean;
    /**
     * use e2ee login or not.
     * @default true
     */
    e2ee?: boolean;
    qr?: undefined;
    authToken?: undefined;
}
export interface QrCodeLoginOption {
    email?: undefined;
    authToken?: undefined;
    qr?: true;
    /**
     * use v3 login or not.
     */
    v3?: boolean;
}
export declare class Login {
    readonly client: BaseClient;
    cert: string | null;
    qrCert: string | null;
    constructor(client: BaseClient);
    /**
     * @description Registers a certificate to be used for login.
     *
     * @param {string | null} cert - The certificate to register. If null, the certificate will be cleared.
     */
    registerCert(cert: string, email: string): Promise<void>;
    /**
     * @description Reads the certificate from the registered path, if it exists.
     *
     * @return {Promise<string | undefined>} The certificate, or undefined if it does not exist or an error occurred.
     */
    getCert(email: string): Promise<string | undefined>;
    /**
     * @description Registers a certificate to be used for login.
     *
     * @param {string | null} qrCert - The certificate to register. If null, the certificate will be cleared.
     */
    registerQrCert(qrCert: string): Promise<void>;
    /**
     * @description Reads the certificate from the registered path, if it exists.
     *
     * @return {Promise<string | undefined>} The certificate, or undefined if it does not exist or an error occurred.
     */
    getQrCert(): Promise<string | undefined>;
    ready(): Promise<void>;
    /**
     * Logs in the user using the provided options.
     *
     * Depending on the options provided, this method will:
     * - Use QR code authentication if no options are provided or if `options.qr` is true.
     * - Use an authentication token if `options.authToken` is provided.
     * - Use email and password authentication if `options.email` is provided.
     *
     * @param {LoginOption} [options] - The login options.
     * @param {boolean} [options.qr] - Whether to use QR code authentication.
     * @param {boolean} [options.v3] - Whether to use version 3 of QR code authentication.
     * @param {string} [options.authToken] - The authentication token.
     * @param {string} [options.email] - The user's email.
     * @param {string} [options.password] - The user's password.
     *
     * @example
     * // Login with QR code
     * await login();
     *
     * @example
     * // Login with authentication token
     * await login({ authToken: 'your-auth-token' });
     *
     * @example
     * // Login with email and password
     * await login({ email: 'user@example.com', password: 'your-password' });
     */
    login(options?: LoginOption): Promise<void>;
    /**
     * Login with qrcode.
     * @param options.v3 use v3 login or not.
     */
    withQrCode(options?: QrCodeLoginOption): Promise<void>;
    requestSQR(): Promise<string>;
    requestSQR2(): Promise<string>;
    /**
     * Login with email and password.
     * @param options.email account e-mail address
     * @param options.password account password
     * @param options.pincode Custom pin-code. It have to be 6-digit.
     * @param options.v3 use v3 login or not.
     * @param options.e2ee use e2ee login or not.
     */
    withPassword(options: PasswordLoginOption): Promise<void>;
    /**
     * @description Login to LINE server with email and password.
     *
     * @param {string} [email] The email to login with.
     * @param {string} [password] The password to login with.
     * @param {boolean} [enableE2EE=false] Enable E2EE Login or not.
     * @param {string} [constantPincode="114514"] The constant pincode.
     * @returns {Promise<string>} The auth token.
     * @throws {InternalError} If the system is not setup yet.
     * @throws {InternalError} If the login type is not supported.
     * @throws {InternalError} If the constant pincode is not valid.
     * @emits pincall
     * @emits update:cert
     */
    requestEmailLogin(email: string, password: string, constantPincode?: string, enableE2EE?: boolean): Promise<string>;
    requestEmailLoginV2(email: string, password: string, constantPincode?: string): Promise<string>;
    /**
     * @description Get RSA key info for login.
     *
     * @param {number} [provider=0] Provider to get RSA key info from.
     * @returns {Promise<LINETypes.RSAKey>} RSA key info.
     * @throws {FetchError} If failed to fetch RSA key info.
     */
    getRSAKeyInfo(provider?: LINETypes.IdentityProvider): Promise<LINETypes.RSAKey>;
    private loginV2;
    createSession(): Promise<LooseType>;
    createQrCode(qrcode: string): Promise<LooseType>;
    checkQrCodeVerified(qrcode: string, maxCount?: number, intervalSec?: number): Promise<boolean>;
    verifyCertificate(qrcode: string, cert?: string | undefined): Promise<LooseType>;
    createPinCode(qrcode: string): Promise<LooseType>;
    checkPinCodeVerified(qrcode: string, maxCount?: number, intervalSec?: number): Promise<boolean>;
    qrCodeLogin(authSessionId: string, autoLoginIsRequired?: boolean): Promise<LooseType>;
    qrCodeLoginV2(authSessionId: string, modelName?: string, systemName?: string, autoLoginIsRequired?: boolean): Promise<LooseType>;
    /**
     * ForSecure variant of {@link createQrCode}.  The newer LINE-Android
     * login flow (LINE 26+) requires this — the legacy `createQrCode`
     * RPC still exists but the server marks issued QR sessions
     * immediately expired, so logins through it fail with `Expired` on
     * the device side.
     *
     * Returns the callback URL, the long-polling parameters
     * (`longPollingMaxCount`, `longPollingIntervalSec`), and a `nonce`
     * that {@link qrCodeLoginV2ForSecure} must echo back to complete
     * the login.
     *
     * Schema source: smali `oc4.i.smali` in LINE Android 26.6.2.
     */
    createQrCodeForSecure(authSessionId: string): Promise<LooseType>;
    /**
     * ForSecure variant of {@link qrCodeLoginV2}.  Echoes the `nonce`
     * received from {@link createQrCodeForSecure}.
     *
     * Schema source: smali `oc4.p.smali` (QrCodeLoginV2ForSecureRequest)
     * in LINE Android 26.6.2.  Field map:
     *   1: authSessionId       (string)
     *   2: systemName          (string)
     *   3: modelName           (string)
     *   4: autoLoginIsRequired (bool)
     *   5: nonce               (string)
     */
    qrCodeLoginV2ForSecure(authSessionId: string, nonce: string, modelName?: string, systemName?: string, autoLoginIsRequired?: boolean): Promise<LooseType>;
    confirmE2EELogin(verifier: string, deviceSecret: Buffer): Promise<LooseType>;
    /**
     * Primary (already-logged-in) device's response to a pending PIN-
     * authorized login on another device.  The new device sees the PIN,
     * the user types it here, and this call ships:
     *   - `verifier`         — the secondary device's auth session id
     *   - `publicKey`        — secondary device's E2EE public key
     *   - `encryptedKeyChain`— this device's E2EE keychain, encrypted
     *                         with the shared secret derived from
     *                         `publicKey`
     *   - `hashKeyChain`     — integrity hash over the plaintext chain
     *   - `errorCode`        — `0` for accept, non-zero rejects
     *
     * Schema recovered from LINE Android 26.6.2 smali at
     * `decompiled/base/smali/smali_classes4/fh8/c1.smali` (the args
     * struct). Desktop/Android 準拠で確定済み。
     *
     * Companion to {@link confirmE2EELogin}, which the new device
     * calls after this one approves.
     */
    respondE2EELoginRequest(opts: {
        verifier: string;
        publicKey: LINETypes.Pb1_C13097n4;
        encryptedKeyChain: Buffer;
        hashKeyChain: Buffer;
        errorCode?: number;
    }): Promise<LooseType>;
}
