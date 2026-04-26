export class BadRequestError extends Error {
  status = 400 as const;
  details?: string[];
  constructor(message: string, details?: string[]) {
    super(message);
    this.name = 'BadRequestError';
    this.details = details;
  }
}

export class NotFoundError extends Error {
  status = 404 as const;
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
