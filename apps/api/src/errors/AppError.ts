export class AppError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'BAD_REQUEST'){
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function toErrorPayload(e: unknown){
  if(e instanceof AppError){
    return { message: e.message, code: e.code };
  }
  return { message: 'Internal error', code: 'INTERNAL_ERROR' };
}
