import { Buffer } from "node:buffer";
import type { Location, Message } from "@vyline/line-types";
import * as LINETypes from "@vyline/line-types";
import type { BaseClient } from "../core/mod.ts";
import type { LooseType } from "@vyline/loose-types";
interface GroupKey {
    privKey: string;
    keyId: number;
}
export declare class E2EE {
    readonly client: BaseClient;
    constructor(client: BaseClient);
    verifyE2EEKeyPair(privKey: Buffer, registeredPubKey: Buffer): boolean;
    verifyStoredKeyAgainstServer(keyId: number | string, privKey: Buffer): Promise<boolean>;
    getE2EESelfKeyData(mid: string): Promise<LooseType>;
    getE2EESelfKeyDataByKeyId(keyId: string | number): Promise<LooseType>;
    saveE2EESelfKeyDataByKeyId(keyId: string | number, value: LooseType): Promise<void>;
    saveE2EESelfKeyData(value: LooseType): Promise<void>;
    getE2EELocalPublicKey(mid: string, keyId?: string | number | undefined): Promise<Buffer | GroupKey>;
    tryRegisterE2EEGroupKey(chatMid: string): Promise<LINETypes.Pb1_U3>;
    generateSharedSecret(privateKey: Buffer, publicKey: Buffer): Uint8Array;
    xor(buf: Buffer): Buffer;
    getSHA256Sum(...args: (string | Buffer)[]): Buffer;
    encryptAESECB(aesKey: Buffer, plainData: Buffer): Buffer;
    decodeE2EEKeyV1(data: LooseType, secret: Buffer): Promise<{
        keyId: LooseType;
        privKey: Buffer;
        pubKey: Buffer;
        e2eeVersion: LooseType;
    } | undefined>;
    decryptKeyChain(publicKey: Buffer, privateKey: Buffer, encryptedKeyChain: Buffer): Buffer[];
    encryptDeviceSecret(publicKey: Buffer, privateKey: Buffer, encryptedKeyChain: Buffer): Buffer;
    generateAAD(a: string, b: string, c: number, d: number, e?: number, f?: number): Buffer;
    getIntBytes(i: number): Uint8Array;
    encryptE2EEMessage(to: string, data: string | Location | Record<string, LooseType>, contentType?: LINETypes.ContentType, specVersion?: number): Promise<Buffer[]>;
    encryptE2EETextMessage(senderKeyId: number, receiverKeyId: number, keyData: Buffer, specVersion: number, text: string | Buffer, to: string, _from: string): Buffer[];
    encryptE2EEMessageByData(senderKeyId: number, receiverKeyId: number, keyData: Buffer, specVersion: number, rawdata: Record<string, LooseType>, to: string, _from: string, contentType: number): Buffer[];
    encryptE2EELocationMessage(senderKeyId: number, receiverKeyId: number, keyData: Buffer, specVersion: number, location: Location, to: string, _from: string): Buffer[];
    encryptE2EEMessageV2(data: Buffer, gcmKey: Buffer, nonce: Buffer, aad: Buffer): Buffer;
    decryptE2EEMessage(messageObj: Message): Promise<Message>;
    decryptE2EETextMessage(messageObj: Message, isSelf?: boolean): Promise<[string, Record<string, string>]>;
    decryptE2EELocationMessage(messageObj: Message, isSelf?: boolean): Promise<Location>;
    decryptE2EEDataMessage(messageObj: Message, isSelf?: boolean): Promise<Record<string, LooseType>>;
    decryptE2EEMessageV1(chunks: Buffer[], privK: Buffer, pubK: Buffer): LooseType;
    decryptE2EEMessageV2(to: string, _from: string, chunks: Buffer[], privK: Buffer, pubK: Buffer, specVersion?: number, contentType?: number): LooseType;
    private e2eeLog;
    createSqrSecret(base64Only?: boolean): [Uint8Array, string];
    registerE2EEKeyPair(): Promise<{
        keyId: number;
        privKey: Buffer;
        pubKey: Buffer;
        e2eeVersion: number;
    } | undefined>;
    _encryptAESCTR(aesKey: Buffer, nonce: Buffer, data: Buffer): Buffer;
    __encryptAESCTR(aesKey: Buffer, nonce: Buffer, data: Buffer): Promise<Buffer>;
    ___encryptAESCTR(aesKey: Buffer, nonce: Buffer, data: Buffer): Buffer;
    _decryptAESCTR(aesKey: Buffer, nonce: Buffer, data: Buffer): Buffer;
    ___decryptAESCTR(aesKey: Buffer, nonce: Buffer, data: Buffer): Promise<Buffer>;
    __decryptAESCTR(aesKey: Buffer, nonce: Buffer, data: Buffer): Buffer;
    signData(data: Buffer, key: Buffer): Buffer;
    deriveKeyMaterial(keyMaterial: Buffer): Promise<{
        encKey: Buffer;
        macKey: Buffer;
        nonce: Buffer;
    }>;
    encryptByKeyMaterial(rawData: Buffer, keyMaterial?: Buffer): Promise<{
        keyMaterial: string;
        encryptedData: Buffer;
    }>;
    decryptByKeyMaterial(rawData: Buffer, keyMaterial: Buffer | string): Promise<Buffer>;
    /**
     * AES-GCM-SIV authenticated decryption. RFC 8452.
     *
     * Used as a low-level primitive by {@link decryptEncryptedQrIdentifier}
     * (LINE's newer secure-login / QR-identity flow). Matches CHRLINE-Patch's
     * `e2ee._decryptAESGCMSIV`.
     *
     * @param gcmsivKey - 16 or 32-byte symmetric key.
     * @param nonce     - 12-byte nonce.
     * @param data      - ciphertext concatenated with the 16-byte tag.
     * @param aad       - optional additional authenticated data.
     */
    decryptAESGCMSIV(gcmsivKey: Buffer, nonce: Buffer, data: Buffer, aad?: Buffer): Buffer;
    /**
     * Decrypt an encrypted QR identifier received during LINE's
     * secure-login / secondary-device handshake.
     *
     * The wire layout is `<12-byte nonce><ciphertext+16-byte tag>` keyed by
     * an ECDH-derived shared secret over Curve25519 (the same shared-secret
     * helper {@link generateSharedSecret} returns).
     *
     * Mirrors CHRLINE-Patch's `e2ee.decryptEncryptedQrIdentifier`.
     */
    decryptEncryptedQrIdentifier(encryptedQrIdentifier: Buffer, privateKey: Buffer, publicKey: Buffer): Buffer;
}
export default E2EE;
