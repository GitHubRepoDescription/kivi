goog.provide('kivi.CDescriptor');
goog.provide('kivi.CDescriptorFlags');
goog.provide('kivi.Component');
goog.require('kivi.ComponentFlags');
goog.require('kivi.Invalidator');
goog.require('kivi.InvalidatorSubscription');
goog.require('kivi.InvalidatorSubscriptionFlags');
goog.require('kivi.scheduler.instance');

/**
 * CDescriptor Flags.
 *
 * @enum {number}
 */
kivi.CDescriptorFlags = {
  SVG: 0x0001
};

/**
 * Component Descriptor.
 *
 * @template D, S
 * @param {string} name
 * @param {number=} opt_flags
 * @constructor
 * @struct
 * @final
 */
kivi.CDescriptor = function(name, opt_flags) {
  this.flags = opt_flags === void 0 ? 0 : opt_flags;
  this.tag = 'div';

  /** @type {?function (!kivi.Component<D, S>)} */
  this.init = null;

  /** @type {?function (!kivi.Component<D, S>, D)} */
  this.setData = null;

  /** @type {?function (!kivi.Component<D, S>, (?Array<!kivi.VNode>|string))} */
  this.setChildren = null;

  /** @type {?function (!kivi.Component<D, S>)} */
  this.update = null;

  /** @type {?function (!kivi.Component<D, S>)} */
  this.invalidated = null;

  /** @type {?function (!kivi.Component<D, S>)} */
  this.disposed = null;

  if (kivi.DEBUG) {
    this.name = name;
  }
};

/**
 * Component.
 *
 * @template D, S
 * @param {number} flags
 * @param {!kivi.CDescriptor<D, S>} descriptor
 * @param {?kivi.Component} parent
 * @param {*} data
 * @param {?Array<!kivi.VNode>|string} children
 * @param {!Element} element
 * @constructor
 * @struct
 * @final
 */
kivi.Component = function(flags, descriptor, parent, data, children, element) {
  /** @type {number} */
  this.flags = flags;

  /** @type {number} */
  this.mtime = 0;

  /** @type {!kivi.CDescriptor<D, S>} */
  this.descriptor = descriptor;

  /** @type {?kivi.Component} */
  this.parent = parent;

  /** @type {number} */
  this.depth = parent === null ? 0 : parent.depth + 1;

  /** @type {D} */
  this.data = data;

  /** @type {S} */
  this.state = null;

  this.children = children;

  /** @type {!Element} */
  this.element = element;

  /**
   * Root node in the Components virtual tree.
   * @type {?kivi.VNode|?CanvasRenderingContext2D}
   */
  this.root = null;

  /** @type {?Array<!kivi.InvalidatorSubscription>|?kivi.InvalidatorSubscription} */
  this._subscriptions = null;

  /** @type {?Array<!kivi.InvalidatorSubscription>|?kivi.InvalidatorSubscription} */
  this._transientSubscriptions = null;

  if (kivi.DEBUG) {
    element.setAttribute('data-kivi-component', descriptor.name);
    element._kiviComponent = this;
  }
};

/**
 * Create a [kivi.Component].
 *
 * @param {!kivi.CDescriptor} descriptor
 * @param {*} data
 * @param {?Array<!kivi.VNode>|string} children
 * @param {?kivi.Component} context
 * @returns {!kivi.Component}
 */
kivi.Component.create = function(descriptor, data, children, context) {
  var element = ((descriptor.flags & kivi.CDescriptorFlags.SVG) === 0) ?
      document.createElement(descriptor.tag) :
      document.createElementNS(kivi.HtmlNamespace.SVG, descriptor.tag);
  var c = new kivi.Component(kivi.ComponentFlags.SHOULD_UPDATE_FLAGS, descriptor, context, data, children, element);
  if (descriptor.init !== null) {
    descriptor.init(c);
  }
  return c;
};

/**
 * Mount a [kivi.Component] on top of existing html.
 *
 * @param {!kivi.CDescriptor} descriptor
 * @param {*} data
 * @param {?Array<!kivi.VNode>|string} children
 * @param {?kivi.Component} context
 * @param {!Element} element
 * @returns {!kivi.Component}
 */
kivi.Component.mount = function(descriptor, data, children, context, element) {
  var c = new kivi.Component(kivi.ComponentFlags.SHOULD_UPDATE_FLAGS | kivi.ComponentFlags.MOUNTING, descriptor, context, data, children, element);
  if (descriptor.init !== null) {
    descriptor.init(c);
  }
  return c;
};

/**
 * Update component.
 */
kivi.Component.prototype.update = function() {
  if ((this.flags & kivi.ComponentFlags.SHOULD_UPDATE_FLAGS) === kivi.ComponentFlags.SHOULD_UPDATE_FLAGS) {
    this.descriptor.update(this);
    this.mtime = kivi.scheduler.instance.clock;
    this.flags &= ~kivi.ComponentFlags.DIRTY;
  }
};

/**
 * Synchronize internal tree using virtual dom representation.
 *
 * If this method is called during mounting phase, then virtual dom will be mounted on top of the existing
 * html tree.
 *
 * @param {!kivi.VNode} newRoot
 */
kivi.Component.prototype.syncVRoot = function(newRoot) {
  if (this.root === null) {
    newRoot.cref = this;
    if ((this.flags & kivi.ComponentFlags.MOUNTING) !== 0) {
      newRoot.mount(this.element, this);
      this.flags &= ~kivi.ComponentFlags.MOUNTING;
    } else {
      newRoot.ref = this.element;
      newRoot.render(this);
    }
  } else {
    this.root.sync(newRoot, this);
  }
  this.root = newRoot;
};

/**
 * Invalidate Component.
 */
kivi.Component.prototype.invalidate = function() {
  if ((this.flags & (kivi.ComponentFlags.DIRTY | kivi.ComponentFlags.DISPOSED)) === 0) {
    this.flags |= kivi.ComponentFlags.DIRTY;
    this.cancelTransientSubscriptions();
    kivi.scheduler.instance.nextFrame().updateComponent(this);
  }
};

/**
 * Start updating Component on each frame.
 */
kivi.Component.prototype.startUpdateEachFrame = function() {
  this.flags |= kivi.ComponentFlags.UPDATE_EACH_FRAME;
  if ((this.flags & kivi.ComponentFlags.IN_UPDATE_QUEUE) === 0) {
    this.flags |= kivi.ComponentFlags.IN_UPDATE_QUEUE;
    kivi.scheduler.instance.startUpdateComponentEachFrame(this);
  }
};

/**
 * Stop updating Component on each frame.
 */
kivi.Component.prototype.stopUpdateEachFrame = function() {
  this.flags &= ~kivi.ComponentFlags.UPDATE_EACH_FRAME;
};

/**
 * Dispose Component.
 */
kivi.Component.prototype.dispose = function() {
  if (kivi.DEBUG) {
    if ((this.flags & kivi.ComponentFlags.DISPOSED) !== 0) {
      throw 'Failed to dispose Component: component is already disposed';
    }
  }

  this.flags |= kivi.ComponentFlags.DISPOSED;
  this.flags &= ~(kivi.ComponentFlags.ATTACHED | kivi.ComponentFlags.UPDATE_EACH_FRAME);
  this.cancelSubscriptions();
  this.cancelTransientSubscriptions();
  if (this.root !== null) {
    this.root.dispose();
  }
  var descriptor = this.descriptor;
  if (descriptor.disposed !== null) {
    descriptor.disposed(this);
  }
};

/**
 * Subscribe to Invalidator object.
 *
 * @param {!kivi.Invalidator} invalidator
 */
kivi.Component.prototype.subscribe = function(invalidator) {
  var s = new kivi.InvalidatorSubscription(kivi.InvalidatorSubscriptionFlags.COMPONENT, invalidator, this);
  invalidator.addSubscription(s);
  var subscriptions = this._subscriptions;
  if (subscriptions === null) {
    this._subscriptions = s;
  } else if (subscriptions.constructor === kivi.InvalidatorSubscription) {
    this._subscriptions = [this._subscriptions, s];
  } else {
    subscriptions.push(s);
  }
};

/**
 * Transient subscribe to Invalidator object.
 *
 * @param {!kivi.Invalidator} invalidator
 */
kivi.Component.prototype.transientSubscribe = function(invalidator) {
  var s = new kivi.InvalidatorSubscription(
      kivi.InvalidatorSubscriptionFlags.COMPONENT | kivi.InvalidatorSubscriptionFlags.TRANSIENT,
      invalidator, this);
  invalidator.addSubscription(s);
  var subscriptions = this._transientSubscriptions;
  if (subscriptions === null) {
    this._transientSubscriptions = s;
  } else if (subscriptions.constructor === kivi.InvalidatorSubscription) {
    this._transientSubscriptions = [this._transientSubscriptions, s];
  } else {
    subscriptions.push(s);
  }
};

/**
 * Remove Subscription.
 *
 * @param {!kivi.InvalidatorSubscription} subscription
 */
kivi.Component.prototype.removeSubscription = function(subscription) {
  var subscriptions;
  var i;
  if ((subscription.flags & kivi.InvalidatorSubscriptionFlags.TRANSIENT) === 0) {
    subscriptions = this._subscriptions;
    if (subscriptions.constructor === kivi.InvalidatorSubscription ||
        subscriptions.length === 1) {
      if (kivi.DEBUG) {
        if (subscriptions.constructor === kivi.InvalidatorSubscription) {
          if (subscriptions !== subscription) {
            throw 'Failed to remove subscription from Component: cannot find appropriate subscription';
          }
        } else {
          subscriptions = /** @type {!Array<!kivi.InvalidatorSubscription>} */(subscriptions);
          if (subscriptions[0] !== subscription) {
            throw 'Failed to remove subscription from Component: cannot find appropriate subscription';
          }
        }
      }
      this._subscriptions = null;
    } else {
      subscriptions = /** @type {!Array<!kivi.InvalidatorSubscription>} */(subscriptions);
      i = subscriptions.indexOf(subscription);
      if (kivi.DEBUG) {
        if (i === -1) {
          throw 'Failed to remove subscription from Component: cannot find appropriate subscription';
        }
      }
      subscriptions[i] = subscriptions.pop();
    }
  } else {
    subscriptions = this._transientSubscriptions;
    if (subscriptions.constructor === kivi.InvalidatorSubscription ||
        subscriptions.length === 1) {
      if (kivi.DEBUG) {
        if (subscriptions.constructor === kivi.InvalidatorSubscription) {
          if (subscriptions !== subscription) {
            throw 'Failed to remove subscription from Component: cannot find appropriate subscription';
          }
        } else {
          subscriptions = /** @type {!Array<!kivi.InvalidatorSubscription>} */(subscriptions);
          if (subscriptions[0] !== subscription) {
            throw 'Failed to remove subscription from Component: cannot find appropriate subscription';
          }
        }
      }
      this._transientSubscriptions = null;
    } else {
      subscriptions = /** @type {!Array<!kivi.InvalidatorSubscription>} */(subscriptions);
      i = subscriptions.indexOf(subscription);
      if (kivi.DEBUG) {
        if (i === -1) {
          throw 'Failed to remove subscription from Component: cannot find appropriate subscription';
        }
      }
      subscriptions[i] = subscriptions.pop();
    }
  }

};

/**
 * Cancels all subscriptions.
 */
kivi.Component.prototype.cancelSubscriptions = function() {
  var subscriptions = this._subscriptions;
  if (subscriptions !== null) {
    if (subscriptions.constructor === kivi.InvalidatorSubscription) {
      subscriptions.invalidator.removeSubscription(/** @type {!kivi.InvalidatorSubscription} */(subscriptions));
    } else {
      subscriptions = /** @type {!Array<!kivi.InvalidatorSubscription>} */(subscriptions);
      for (var i = 0; i < subscriptions.length; i++) {
        var s = subscriptions[i];
        s.invalidator.removeSubscription(s);
      }
    }
  }
  this._subscriptions = null;
};

/**
 * Cancels all transient subscriptions.
 */
kivi.Component.prototype.cancelTransientSubscriptions = function() {
  var subscriptions = this._transientSubscriptions;
  if (subscriptions !== null) {
    if (subscriptions.constructor === kivi.InvalidatorSubscription) {
      subscriptions.invalidator.removeSubscription(/** @type {!kivi.InvalidatorSubscription} */(subscriptions));
    } else {
      for (var i = 0; i < subscriptions.length; i++) {
        subscriptions = /** @type {!Array<!kivi.InvalidatorSubscription>} */(subscriptions);
        var s = subscriptions[i];
        s.invalidator.removeSubscription(s);
      }
    }
  }
  this._transientSubscriptions = null;
};
