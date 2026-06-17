export class HTTPException extends Error {
  constructor(status, options = {}) {
    super(options.message || 'Unknown Error')
    this.status = status
    this.name = 'HTTPException'
  }
}
