export class GitError extends Error {
    /**
     * @param {!string} message
     * @param {?number} code
     * @param {?string} signal
     */
    constructor(message, code, signal) {
        super(message);
        this.name = "GitError";
        this.code = code;
        this.signal = signal;
    }
}
