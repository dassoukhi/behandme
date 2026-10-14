/** A message whose content its consumer cannot read (wrong payload or version): never retried. */
export class MalformedMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedMessageError";
  }
}
