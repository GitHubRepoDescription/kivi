/**
 * **EXPERIMENTAL** actors model implementation.
 */
import {scheduler} from "./scheduler";

/**
 * Message flags.
 */
export const enum MessageFlags {
  // Enable message tracing.
  Trace         = 1,
  // Message were created from an action initiated by user.
  UserInitiated = 1 << 1
}

let _nextActorId = 0;
let _nextMessageFlag = 1 << 1;

/**
 * Acquire a message flag at runtime.
 */
export function acquireMessageFlag(): number {
  _nextMessageFlag <<= 1;
  return _nextMessageFlag;
}

/**
 * Actor flags.
 */
export const enum ActorFlags {
  // Actor is registered in the scheduler actor task queue.
  Active          = 1,
  // Inbox has an incoming message.
  IncomingMessage = 1 << 1,
}

/**
 * Message handler function.
 */
export type ActorMessageHandler<P, S> = (actor: Actor<P, S>, message: Message<any>, props: P, state: S) => S;

/**
 * Middleware handler.
 */
export type ActorMiddleware<P, S> =
  (actor: Actor<P, S>, message: Message<any>, next: ActorNextMiddleware<P, S>) => void;
export type ActorNextMiddleware<P, S> = (message: Message<any>) => void;

/**
 * Message group.
 *
 * Example:
 *
 *     const RouterMessages = new MessageGroup("app.router");
 *     const ChangeRoute = RouterMessages.create<string>("changeRoute");
 *     const msg = ChangeRoute.create("/home");
 */
export class MessageGroup {
  /**
   * Id counter that is used to generate unique ids for message descriptors.
   */
  _nextId: number;
  /**
   * Flags that will be marked on message descriptor instances. See `MessageDescriptorFlags` for details.
   */
  _markDescriptorFlags: number;
  /**
   * Flags that will be marked on message instances. See `MessageFlags` for details.
   */
  _markMessageFlags: number;
  /**
   * Group name.
   */
  readonly name: number | string;
  /**
   * Metadata.
   */
  _meta: Map<Symbol, any>;

  constructor(id: number | string) {
    this._nextId = 0;
    this._markDescriptorFlags = 0;
    this._markMessageFlags = 0;
    this.name = id;
    this._meta = new Map<Symbol, any>();
  }

  /**
   * Maximum id that was used to create message descriptors.
   */
  maxId(): number {
    return this._nextId;
  }

  /**
   * Acquire a new id.
   */
  acquireId(): number {
    return this._nextId++;
  }

  /**
   * Enable tracing for all messages in this group.
   */
  enableTracing(): MessageGroup {
    this._markMessageFlags |= MessageFlags.Trace;
    return this;
  }

  /**
   * Set metadata.
   */
  setMeta<M>(key: Symbol, value: M): MessageGroup {
    this._meta.set(key, value);
    return this;
  }

  /**
   * Create a new message descriptor.
   */
  create<P>(id: number | string): MessageDescriptor<P> {
    return new MessageDescriptor<P>(this, this.acquireId(), id, this._markDescriptorFlags, this._markMessageFlags);
  }
}

/**
 * Message descriptor.
 */
export class MessageDescriptor<P> {
  /**
   * Flags, see `MessageDescriptorFlags` for details.
   */
  _flags: number;
  /**
   * Flags that will be marked on message instances. See `MessageFlags` for details.
   */
  _markFlags: number;
  /**
   * Unique id.
   */
  readonly uid: number;
  /**
   * Static identifier.
   */
  readonly id: number | string;
  /**
   * Message group.
   */
  readonly group: MessageGroup;
  /**
   * Metadata.
   */
  _meta: Map<Symbol, any>;

  constructor(group: MessageGroup, uid: number, id: number | string, flags: number, messageFlags: number) {
    this._flags = flags;
    this._markFlags = messageFlags;
    this.uid = uid;
    this.id = id;
    this.group = group;
    this._meta = new Map<Symbol, any>();
  }

  /**
   * Enable tracing.
   */
  enableTracing(): MessageDescriptor<P> {
    this._markFlags |= MessageFlags.Trace;
    return this;
  }

  /**
   * Add metadata.
   */
  setMeta<M>(key: Symbol, value: M): MessageDescriptor<P> {
    this._meta.set(key, value);
    return this;
  }

  /**
   * Create a new message.
   */
  create(payload: P): Message<P> {
    return new Message<P>(this, payload, this._markFlags);
  }
}

/**
 * Messages are used for communications between actors.
 */
export class Message<P> {
  /**
   * Flags, see `MessageFlags` for details.
   */
  _flags: number;
  /**
   * Message descriptor.
   */
  readonly descriptor: MessageDescriptor<P>;
  /**
   * Message payload.
   */
  readonly payload: P;
  /**
   * Metadata.
   */
  _meta: Map<Symbol, any> | null;

  constructor(descriptor: MessageDescriptor<P>, payload: P, flags: number) {
    this._flags = flags;
    this.descriptor = descriptor;
    this.payload = payload;
    this._meta = null;
  }

  /**
   * Add metadata.
   */
  setMeta<M>(key: Symbol, value: M): Message<P> {
    if (this._meta === null) {
      this._meta = new Map<Symbol, any>();
    }
    this._meta.set(key, value);
    return this;
  }

  /**
   * Get metadata.
   */
  getMeta<M>(key: Symbol): M | undefined {
    let value = this.descriptor.group._meta.get(key);
    if (value === undefined) {
      value = this.descriptor._meta.get(key);
    }
    if (value === undefined && this._meta !== null) {
      value = this._meta.get(key);
    }
    return value;
  }
}

/**
 * Actor descriptor.
 *
 *     const StoreActor = new ActorDescriptor<Props, State>()
 *       .handleMessage((message, state) => {
 *         if (message.descriptor === DeleteItemMessage) {
 *           state.removeItem(message.payload as number);
 *         }
 *         return state;
 *       });
 */
export class ActorDescriptor<P, S> {
  /**
   * Flags, see `ActorDescriptorFlags` for details.
   */
  _flags: number;
  /**
   * Flags that will be marked on actor instances, see `ActorFlags` for details.
   */
  _markFlags: number;
  /**
   * Create state handler.
   */
  _createState: ((actor: Actor<P, S>, props: P | null) => S) | null;
  /**
   * Init handler.
   */
  _init: ((actor: Actor<P, S>, props: P | null, state: S | null) => void) | null;
  /**
   * Message handler.
   */
  _handleMessage: ActorMessageHandler<P, S> | null;
  /**
   * Middleware handlers.
   */
  _middleware: ActorMiddleware<P, S>[] | null;
  /**
   * Disposed handler.
   */
  _disposed: ((actor: Actor<P, S>, props: P | null, state: S | null) => void) | null;

  constructor() {
    this._flags = 0;
    this._markFlags = 0;
    this._createState = null;
    this._init = null;
    this._handleMessage = null;
    this._middleware = null;
  }

  /**
   * Create a new actor.
   */
  create(props?: P): Actor<P, S> {
    const actor = new Actor<P, S>(this, props, this._markFlags);
    if (this._createState !== null) {
      actor.state = this._createState(actor, actor.props);
    }
    if (this._init !== null) {
      this._init(actor, actor.props, actor.state);
    }
    return actor;
  }

  addMiddleware(middleware: ActorMiddleware<any, any>): ActorDescriptor<P, S> {
    if (this._middleware === null) {
      this._middleware = [];
    }
    this._middleware.push(middleware);
    return this;
  }

  createState(handler: (actor: Actor<P, S>, props: P | null) => S): ActorDescriptor<P, S> {
    this._createState = handler;
    return this;
  }

  init(handler: (actor: Actor<P, S>, props: P | null, state: S | null) => S): ActorDescriptor<P, S> {
    this._init = handler;
    return this;
  }

  handleMessage(handler: ActorMessageHandler<P, S>): ActorDescriptor<P, S> {
    this._handleMessage = handler;
    return this;
  }

  disposed(handler: (actor: Actor<P, S>, props: P | null, state: S | null) => S): ActorDescriptor<P, S> {
    this._disposed = handler;
    return this;
  }
}

/**
 * Actor.
 */
export class Actor<P, S> {
  /**
   * Unique Id.
   */
  readonly id: number;
  /**
   * Flags, see `ActorFlags` for details.
   */
  _flags: number;
  /**
   * Actor descriptor.
   */
  readonly descriptor: ActorDescriptor<P, S>;
  /**
   * Props.
   */
  props: P | null;
  /**
   * State.
   */
  state: S | null;
  /**
   * Message inbox.
   */
  _inbox: Message<any>[];
  /**
   * Middleware handlers.
   */
  _middleware: ActorMiddleware<P, S>[] | null;

  constructor(descriptor: ActorDescriptor<P, S>, props: P | undefined, flags: number) {
    this.id = _nextActorId++;
    this._flags = flags;
    this.descriptor = descriptor;
    this.props = props === undefined ? null : props;
    this.state = null;
    this._inbox = [];
    this._middleware = null;
  }

  /**
   * Send a message to an actor.
   */
  send(message: Message<any>): void {
    scheduler.sendMessage(this, message);
  }

  dispose(): void {
    if (this.descriptor._disposed !== null) {
      this.descriptor._disposed(this, this.props, this.state);
    }
  }

  addMiddleware(middleware: ActorMiddleware<any, any>): Actor<P, S> {
    if (this._middleware === null) {
      this._middleware = [];
    }
    this._middleware.push(middleware);
    return this;
  }
}

export function actorAddMessage(actor: Actor<any, any>, message: Message<any>): void {
  if ((actor._flags & ActorFlags.IncomingMessage) === 0) {
    actor._flags |= ActorFlags.IncomingMessage;
  }
  actor._inbox.push(message);
}

/**
 * Helper function for TypeScript developers to extract payload from messages.
 */
export function getMessagePayload<P>(descriptor: MessageDescriptor<P>, message: Message<P>): P {
  return message.payload;
}
