const Auth = (function(props) {

  /**
   * IDMOD.ORG AUTH
   * Means for Authorization into IDM Systems for Web Clients.
   *
   * @copyright (c) 2022 Bill & Melinda Gates Foundation. All Rights Reserved.
   * @license CC-BY-NC-SA-4.0
   * @requires "HTML5", "ECMA-262 Edition 5.1"
   *
   */

  /**
   * PRIVATE MEMBERS (these are RESERVED terms set with DEFAULT values)
   *
   * NOTE:
   * This library is pre-configured for the COMPS application (as defaults).
   * All other applications must override essential parameters as need be.
   * @example Auth.init({ ApplicationName:"Training" });
   *
   * @private
   * @property {String} version is the semantic versioning of this code.
   * @property {Object} context are additional variables required for authentication.
   * @property {Object} cookieItems are the globally-assumed standards among IDM applications.
   * @property {Object} formAction are the attribute values supported for UI forms (turnkey or otherwise).
   * @property {Boolean} refreshing is a flag to rebuff multiple calls to refreshCredentials();
   * @property {String} requestHeaderName is the sanctioned header name for an authorized XMLHttpRequest object.
   * @property {String} identity is the namespace prefixed to unique properties and attributes.
   * @property {String} markupId is the element ID of the HTML to be injected.
   * @property {DOMElement} element is the node appended into the parentElement.
   * @property {DOMElement} styles is the node appended into the document <head>.
   */

  const version = "3.0.0";
  const context = {
    ApplicationName: "",
    ClientVersion: 11
  };
  const cookieItems = {
    User: "User",
    Token: "Token",
    Active: "Active",
    Test: "Test",
    localize: function(input) {
      let suffix = window.location.host;
      let result = CONFIG.endpoint.match(/^(HTTPS?\:\/\/)(.*)(\/API\/?)$/i);
      if (!!input && !/^false|true$/i.test(input)) {
        suffix = input;
      } else if (!!result) {
        suffix = result[2];
      }
      for (let name in this) {
        if (this.hasOwnProperty(name)) {
          if (typeof this[name]==="string") {
            this[name]=this[name].replace(/-.*|$/,`-${suffix.replace(/\:/g,".")}`);
          }
        }
      }
    }
  };
  const formAction = {
    submitCredentials: "submitCredentials",
    passwordReset: "passwordReset",
    passwordChange: "passwordChange"
  };

  const requestHeaderName = "X-COMPS-Token";
  const identity = "idmauth";
  const markupId = identity + Date.now();
  let element, styles;
  let refreshing = false;

  /**
   * CONFIG (with DEFAULTS)
   *
   * @public via init(settings);
   * @property {String} endpoint is the service API for authentication. "/api/" for COMPS.
   * @property {Boolean|String} localize when not false, will suffix cookies as exclusive to -string or -endpoint or -location.host.
   * @property {Boolean} allowBypass when true, provides an option to fake token (for dev).
   * @property {Boolean} passwordPeek when true, renders turnkeyUI with ability to show password for user's visual verification.
   * @property {Boolean} turnkeyUI when true, a default UI is created here for siginin.
   * @property {Number} zIndex is the turnkeyUI's relative display layer as defined by CSS z-index property.
   * @property {DOMElement} parentElement is node to which element is appended (if null, then document.body).
   */
  const ZMAX = 2147483647; /* CSS: Maximum value for z-index property of absolute-positioned DOM element. */
  const CONFIG = {
    endpoint: "",
    localize: true,
    allowBypass: false,
    passwordPeek: true,
    turnkeyUI: true,
    zIndex: ZMAX-100,
    parentElement: null
  };

  /* POLYFILLS */

  if (window.NodeList && !NodeList.prototype.forEach) {
    /* IE does not support NodeList.forEach */
    NodeList.prototype.forEach = function (callback, thisArg) {
      thisArg = thisArg || window;
      for (let i = 0; i < this.length; i++) {
        callback.call(thisArg, this[i], i, this);
      }
    };
  }

  /* Object.assign(); */
  /* https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/assign */
  if (typeof Object.assign != "function") {
    // Must be writable: true, enumerable: false, configurable: true
    Object.defineProperty(Object, "assign", {
      value: function assign(target, varArgs) { // .length of function is 2
        "use strict";
        if (target == null) { // TypeError if undefined or null
          throw new TypeError("Cannot convert undefined or null to object");
        }

        let to = Object(target);

        for (let index = 1; index < arguments.length; index++) {
          let nextSource = arguments[index];

          if (nextSource != null) { // Skip over if undefined or null
            for (let nextKey in nextSource) {
              // Avoid bugs when hasOwnProperty is shadowed
              if (Object.prototype.hasOwnProperty.call(nextSource, nextKey)) {
                to[nextKey] = nextSource[nextKey];
              }
            }
          }
        }
        return to;
      },
      writable: true,
      configurable: true
    });
  }

  /* UTILITIES */

  /**
   * pubsub is for subscribing listeners for remarkable events.
   * NOTE: This is precongifured for "prompt", "signin" "signout", "resume", and "error" events.
   * NOTE: A listener's callback is assumed to usurp any user-experience resolution prescribed here as default.
   *
   * @private + @public addEventListener and removeEventListener.
   *
   * @event "prompt" fires upon a request for user credentials (turnkeyUI ONLY).
   * @event "signin" fires upon a successful signin. Callback is passed: the Response object.
   * @event "access" fires upon receipt of User Permissions. Callback is passed: the User Info object.
   * @event "signout" fires upon the ending of a session. Callback is passed: a prescribed message.
   * @event "resume" fires upon initializing with a viable token or when tab returns to view. Callback is passed: the Event.
   * @event "error" fires upon an unexpected service response. Callback is passed: { Request, Response, Message }
   * @event "success" fires upon a success of service calls OTHER than signin. Callback is passed: { Request, Response, Message }
   *
   * @usage pubsub.subscribe("signin", "uniqueIdentifier", someFunction);
   * @usage pubsub.unsubscribe("signin", "uniqueIdentifier"); // all listeners of that event which are so-named will be removed!
   * @usage pubsub.publish("signin", someRelevantData);
   */
  const pubsub = {
    events: {
      "prompt": [],
      "signin": [],
      "access": [],
      "signout": [],
      "resume": [],
      "error": [],
      "success": []
    },
    subscribe: function (eventName, observer, callback) {
      if (!!eventName && eventName in this.events) {
        if (!!callback && callback instanceof Function) {
          this.events[eventName] = this.events[eventName] || [];
          this.events[eventName].push({ observer: observer, callback: callback });
        }
      } else {
        console.error("idmorg-auth:pubsub:",'"Attempt to subscribe to unknown event!" Use:', Object.keys(this.events));
      }
    },
    unsubscribe: function (eventName, observer) {
      if (!!eventName && eventName in this.events) {
        for (let i = 0; i < this.events[eventName].length; i++) {
          if (this.events[eventName][i].observer === observer) {
            this.events[eventName].splice(i, 1);
            break;
          }
        };
      } else {
        console.error("idmorg-auth:pubsub:",'"Attempt to unsubscribe from unknown event!" Use:', Object.keys(this.events));
      }
    },
    publish: function (eventName, data) {
      if (this.events[eventName]) {
        this.events[eventName].forEach(function (instance) {
          try {
            instance.callback(data);
          } catch (err) {
            console.warn("idmorg-auth:pubsub:", eventName, instance);
          }
        });
      }
    },
    isSubscribed: function(eventName) {
      return eventName in this.events && this.events[eventName].length > 0;
    },
    isSubscribedByWho: function (eventName) {
      if (this.events && eventName in this.events) {
        return this.events[eventName];
      } else {
        return null;
      }
    },
    initialize: function () {
      for (let listener in this.events) {
        this.events[listener] = [];
      }
    }
  };

  /* TOKEN HANDLING */

  /**
   * tokenMap are the index positions of a split token
   * @static
   */
  const tokenMap = {
    Version: 0,
    Type: 1,
    UserName: 2,
    Host: 3,
    CreationHost: 5,
    Expires: 6,
    CreationDate: 7,
    CodeCreatedLocation: 9,
    EmailAddress: 11
  };

  /**
   * LIMIT are time values pertinent to token viability.
   *
   * @static
   * @property {Number} expire (4.0 hours) is the time that a token remains valid.
   * @property {Number} waning (0.5 hours) is the time before expiration when an interaction will auto-refresh the token.
   * @property {Number} recent (1.5 hours) is the time since expiration considered to be within the previous session.
   */
  const LIMIT = {
    expire: Math.floor(4.0 * (60 * 60 * 1000)),
    waning: Math.floor(0.5 * (60 * 60 * 1000)),
    recent: Math.floor(1.5 * (60 * 60 * 1000))
  };

  /**
   * convertTokenDateStringToDate converts from YYYY-MM-DD-HH-MM-SS string to Date object.
   *
   * @private
   * @param {String} str is the token-formatted date value.
   * @return {Date} the JavaScript Date object (of Date.now() if null or fail).
   */
  const convertTokenDateStringToDate = function (str) {
    let value = "";
    if (!!str && (typeof str === "string" || str instanceof String)) {
      value = str.replace(/(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/g, "$1-$2-$3T$4:$5:$6Z");
    }
    if (!!Date.parse(value)) {
      return new Date(Date.parse(value));
    } else {
      return new Date();
    }
  };

  /**
   * convertDateToTokenDateString converts from Date object to "YYYY-MM-DD-HH-MM-SS" string.
   *
   * @private
   * @param {Date} dateObject is a JavaScript Date object.
   * @return {String} the converted token-formatted date value (of Date.now() if null or fail).
   */
  const convertDateToTokenDateString = function (dateObject) {
    let dte;
    if (arguments.length > 0 && dateObject instanceof Object && "getUTCFullYear" in dateObject) {
      dte = dateObject;
    } else {
      dte = new Date();
    }
    return [
      dte.getUTCFullYear(),
      dte.getUTCMonth() + 1,
      dte.getUTCDate(),
      dte.getUTCHours(),
      dte.getUTCMinutes(),
      dte.getUTCSeconds()
    ].map(function(i){ return i<10?"0"+i:i; }).join("-");
  };

  /**
   * getToken supplies the token as required for REST header value for X-COMPS-Token.
   * NOTE: A check is always done to initiate a silent refresh if token is waning.
   * NOTE: In a normal course of events, this code is called quite often.
   *
   * @public
   * @param {Boolean} silently (optional) when true, no events will trigger.
   * @return {String} the current token value (null when signed-out).
   */
  const getToken = function (silently) {
    let test = cookies.getItem(cookieItems.Test);
    let token = cookies.getItem(cookieItems.Token);
    let details = !!test ? test.split(",") : !!token ? token.split(",") : [];
    let expiresDate = convertTokenDateStringToDate(details[tokenMap.Expires]);
    if (expiresDate.getTime() < Date.now()) {
      endSession(null, null, silently);
      return null;
    } else if (!!token && (expiresDate.getTime() - Date.now()) < LIMIT.waning) {
      if (!!CONFIG.allowBypass) {
        setBypassToken();
      } else {
        refreshCredentials(token);
      }
    }
    return token;
  };

  /**
   * tokenExpiresDate converts token's "YYYY-MM-DD-HH-MM-SS" value to a Date.
   *
   * @private
   * @return {Date}
   */
  const tokenExpiresDate = function () {
    let test = cookies.getItem(cookieItems.Test);
    let token = cookies.getItem(cookieItems.Token);
    let details = !!test ? test.split(",") : !!token ? token.split(",") : [];
    return convertTokenDateStringToDate(details[tokenMap.Expires]);
  };

  /**
   * tokenIsExpired determines whether session has expired.
   *
   * @public by proxy
   * @return {Boolean} true when expired.
   */
  const tokenIsExpired = function () {
    return tokenExpiresDate() <= Date.now();
  };

  /**
   * tokenIsWaning will trigger a refreshCredentials when session is close to expiring.
   *
   * @public by proxy
   * @return {Boolean} true when waning, false when expired or viable.
   */
  const tokenIsWaning = function () {
    if (tokenIsExpired()) {
      return false;
    } else {
      return (tokenExpiresDate() - Date.now()) < LIMIT.waning;
    }
  };

  /**
   * tokenIsRecent is used to qualify session as probably being resumed (rather than new).
   *
   * @private
   * @return {Boolean} true when token only recently expired.
   */
  const tokenIsRecent = function () {
    return (Date.now() - tokenExpiresDate()) < LIMIT.recent;
  };

  /**
   * tokenIsViable will test the current (or a transient) token.
   * NOTE: This is a superficial test and does not guarantee API will accept token as valid.
   * NOTE: A check is always done to initiate a silent refresh if token is waning.
   *
   * @public by proxy
   * @param {String} temp (optional) is any string to test for validity (when null, the local token is tested).
   * @return {Boolean} when true, the tested token has essential components and is not expired.
   */
  const tokenIsViable = function (temp) {

    let info, token = arguments.length > 0 ? temp : cookies.getItem(cookieItems.Token);
    let details = !!token && (typeof token === "string" || token instanceof String) ? token.split(",") : [];
    let username, expiresDate;

    if (details.length > Math.max(tokenMap.UserName, tokenMap.Expires)) {
      username = details[tokenMap.UserName];
      expiresDate = convertTokenDateStringToDate(details[tokenMap.Expires]);
    }

    if (!!temp) {
      return (!!username && !!expiresDate && (Date.now() < expiresDate));
    } else {
      info = getUserInfo();
      if (!!info && "UserName" in info && !!username && info.UserName == username) {
        if (!!expiresDate) {
          if ((expiresDate - Date.now()) < LIMIT.waning) {
            refreshCredentials(token);
          }
          return Date.now() < expiresDate;
        } else {
          return false;
        }
      } else {
        return false;
      }
    }
  };

  /**
   * getParsedToken will read Token cookie and split it to pertinent name:value parts (per tokenMap).
   *
   * @public by proxy
   * @param {String} temp (optional) is any token string to parse (when null, the local token is tested).
   * @return {Object|null} the parsed Token or null if fail.
   */
  const getParsedToken = function (temp) {

    let token = arguments.length > 0 ? temp : cookies.getItem(cookieItems.Token);
    let pairs = null;
    let values = !!token && (typeof token === "string" || token instanceof String) ? token.split(",") : [];

    if (values.length > 0) {
      pairs = { Token: token };
      for (let param in tokenMap) {
        if (tokenMap.hasOwnProperty(param)) {
          pairs[param] = values[tokenMap[param]];
        }
      }
    }

    return pairs;
  };

  /**
   * setBypassToken spoofs a viable token whenever allowBypass is true (for dev).
   * NOTE: This will affect token cookie for all IDM applications within a browser instance!
   *
   * @private
   * @param {Object} credentials (optional) are the { UserName,Password } intended for signin.
   * @return {null}
   */
  const setBypassToken = function (credentials) {
    let bypassToken = new Array(Math.max(tokenMap.UserName, tokenMap.Expires) + 1);
    let expiresDate = new Date(Date.now() + LIMIT.expire);
    bypassToken[tokenMap.UserName] = !!credentials && "UserName" in credentials ? credentials.UserName : "bypassUser";
    bypassToken[tokenMap.Expires] = convertDateToTokenDateString(expiresDate);
    cookies.setItem(cookieItems.Token, bypassToken, Infinity);
    cookies.removeItem(cookieItems.Test);
  };

  /* USER MANAGEMENT */

  /**
   * setUserInfo sets current User information to a cookie.
   * NOTE: info structure is assumed tokens? Response.RequestingToken or users? Response.Users[0]
   *
   * @private
   * @param {Object} info (optional) is the Response data to store.
   * @return {Boolean} true if info is valid and cookie stored successfully.
   */
  const setUserInfo = function (info) {
    try {
      delete info.Password;
      delete info.PasswordHash;
      delete info.EncryptionKeyHash;
      delete info.HeaderValue;
      if (cookies.setItem(cookieItems.User, JSON.stringify(info), Infinity)) {
        pubsub.publish("access", info);
        return true;
      } else {
        return false;
      }
    } catch (err) {
      console.warn("idmorg-auth:setUserInfo:", err);
      return false;
    }
  };

  /**
   * getUserInfo gets current User information from the User cookie.
   * NOTE: Triggers call for requestUserInfo(); if none is found.
   *
   * @private + @public getters for Roles, Applications, Groups, Environments
   * @return {Object|null} JSON of all User Info or null when fail.
   */
  const getUserInfo = function () {
    let info, cookie = cookies.getItem(cookieItems.User);
    try {
      info = JSON.parse(cookie);
    } finally {
      if (!!info && "UserName" in info) {
        return info;
      } else {
        info = getParsedToken();
        if (!!info && "UserName" in info && "Token" in info) {
          requestUserInfo(info);
        }
        return null;
      }
    }
  };

  /**
   * getUserName gets current UserName from the User cookie.
   * NOTE: Triggers call for requestUserInfo(); if none is found.
   *
   * @public by proxy
   * @return {String|null} the UserName value.
   */
  const getUserName = function () {
    let info, cookie = cookies.getItem(cookieItems.User);
    try {
      info = JSON.parse(cookie);
    } finally {
      if (!!info && "UserName" in info) {
        return info.UserName;
      } else {
        info = getParsedToken();
        if (!!info && "UserName" in info && "Token" in info) {
          requestUserInfo(info);
          return info.UserName;
        } else {
          return null;
        }
      }
    }
  };

  /**
   * getApplicationAccess derives application permissions of current User.
   *
   * @private
   * @param {String} query (optional) is a specific ApplicationName to test.
   * @return {Array|Boolean} List of accessible ApplicationName(s) or true|false when query.
   */
  const getApplicationAccess = function (query) {
    let info,
      testing = arguments.length > 0,
      cookie = cookies.getItem(cookieItems.User);
    try {
      info = JSON.parse(cookie);
    } finally {
      if (!!info && "Applications" in info && Array.isArray(info.Applications)) {
        return testing ? info.Applications.indexOf(query) > -1 : info.Applications;
      } else {
        return testing ? false : [];
      }
    }
  };

  /**
   * syncApplicationActivity maintains list of active ApplicationName(s) in a cookie.
   *
   * @private
   * @param {String} name (optional) is an ApplicationName to activate (permissibility is assumed).
   * @param {Boolean} remove (optional) when true, removes given ApplicationName from list.
   * @return {Array} the list of currently active ApplicationName(s)
   */
  const syncApplicationActivity = function (name, remove) {
    let active = [], cookie = cookies.getItem(cookieItems.Active);
    try {
      if (!!cookie) {
        active = cookie.split(",");
      }
    } finally {
      if (/string/i.test(typeof name)) {
        if (active.indexOf(name) > -1) {
          if (!!remove) {
            active.splice(active.indexOf(name), 1);
            cookies.setItem(cookieItems.Active, active.join(","));
          }
        } else {
          if (!remove) {
            active.push(name);
            cookies.setItem(cookieItems.Active, active.join(","));
          }
        }
      }
      return active;
    }
  };

  /**
   * hasPermission queries if a specific permission is afforded to the current User.
   * NOTE: realm and value are strictly case-sensitive!
   *
   * @public by proxy
   * @param {String} realm is the permission type (e.g. "Applications", "Environments", "Groups", "Roles").
   * @param {String} value is the permission value (e.g. "COMPS" among "Applications").
   * @return {Boolean} true when User has access to the queried scope.
   */
  const hasPermission = function (realm, value) {
    let info, cookie = cookies.getItem(cookieItems.User);
    try {
      info = JSON.parse(cookie);
    } finally {
      if (!!info && arguments.length > 1 && realm in info) {
        if (Array.isArray(info[realm])) {
          return info[realm].indexOf(value) > -1;
        } else if (typeof info[realm] === "object") {
          return value in info[realm] && !!info[realm][value];
        } else {
          return false;
        }
      } else {
        return false;
      }
    }
  };

  /* SESSION MANAGEMENT */

  /**
   * startSession looks for token and either resumes a session or begins a new one.
   *
   * @private
   * @callback {Function} signedin (optional) handles resumption of a session.
   * @callback {Function} signedout (optional) handles establishing a session.
   * @return {Boolean} true when a session is active and viable.
   */
  const startSession = function (signedin, signedout) {
    if (tokenIsViable()) {
      if (getApplicationAccess(context.ApplicationName)) {
        syncApplicationActivity(context.ApplicationName);
        pubsub.publish("access", getUserInfo());
        if (!!signedin && signedin instanceof Function) {
          signedin();
        }
        return true;
      } else {
        if (!!signedout && signedout instanceof Function) {
          signedout();
        }
        endSession(context.ApplicationName, "Permission is required to access this application.");
        return false;
      }
    } else {
      if (!!signedout && signedout instanceof Function) {
        signedout();
      }
      endSession(null, "Please sign in.");
      return false;
    }
  };

  /**
   * endSession does clean-up after signout, such as removing cookies.
   * NOTE: Parameters are assumed to be a valid ApplicationName or null or undefined.
   *
   * @private
   * @param {String} appName (optional) will signout selectively. When null, signout is universal.
   * @param {String} message (optional) relevant communication for User.
   * @param {Boolean} silently (optional) when true, event publish is suppressed.
   * @return {null}
   */
  const endSession = function (appName, message, silently) {
    let activeApps = syncApplicationActivity(appName||context.ApplicationName, true);
    if (/undefined|null|^$/.test(appName) || activeApps.length < 1) {
      for (let item in cookieItems) {
        if (cookieItems.hasOwnProperty(item)) {
          cookies.removeItem(cookieItems[item]);
        }
      }
    }
    if (!silently) {
      pubsub.publish("signout", message);
    }
  };

  const handleVisibilityChange = function (event) {

    if (document.hidden) {
      // TODO: suspend processes?
    } else {
      startSession(
        function () {
          // user is signed-in
          pubsub.publish("resume", event);
          if (CONFIG.turnkeyUI) {
            dismissUI();
          }
        },
        function () {
          // user is signed-out
          if (CONFIG.turnkeyUI) {
            dispatchUI();
          }
        }
      );
    }
  };

  /* SERVICE TRANSACTIONS */

  /**
   * requestUserInfo secures the Roles, Applications, Groups, and Environments available to the current User.
   * NOTE: No input validation here. Supplied info are expected to be vetted and well-formed.
   * NOTE: By default, a successful transaction will store User Info locally as a cookie.
   *
   * @private
   * @param {Object} info are { UserName:"value", Token:"value" } required for request.
   * @callback {Function} successHandler (optional). The Response's JSON.parse(responseText) and Request XHR are passed to this handler.
   * @callback {Function} failureHandler (optional). The Response's statusText and Request XHR are passed to this handler.
   */
  const requestUserInfo = function (info, successHandler, failureHandler) {
    try {

      let user, response,
        url = CONFIG.endpoint + "users/" + info.UserName + "?format=json",
        request = new XMLHttpRequest();

      request.open("GET", url, true);
      request.onreadystatechange = function () {
        if (request.readyState === 4) {
          if (request.status === 200) {
            response = JSON.parse(request.responseText);
            if ("Users" in response && !!response.Users.length) {
              user = response.Users[0];
              setUserInfo(user);
            }
            if (!!successHandler && successHandler instanceof Function) {
              successHandler(response, request);
            }
          } else {
            response = request.statusText;
            if (!!failureHandler && failureHandler instanceof Function) {
              failureHandler(response, request);
            }
          }
        }
      };
      request.setRequestHeader(requestHeaderName, info.Token);
      request.setRequestHeader("Content-Type", "application/json");
      request.send();
    } catch (err) {
      console.error("idmorg-auth:requestUserInfo:", err);
      throw err;
    }
  };

  /**
   * refreshCredentials renews a token for an extended Expires time.
   * NOTE: By default, a successful transaction will store Token and User Info locally as cookies.
   * NOTE: This is exclusive. In duration, subsequent calls will be rebuffed (see: @property {Boolean} refreshing).
   *
   * @public by proxy
   * @param {String} token (optional) a convenience offering if value is handy when calling this method.
   * @callback {Function} successHandler (optional). The Response's JSON.parse(responseText) and Request XHR are passed to this handler.
   * @callback {Function} failureHandler (optional). The Response's statusText and Request XHR are passed to this handler.
   */
  const refreshCredentials = function (token, successHandler, failureHandler) {

    if (refreshing) {
      if (!!successHandler && successHandler instanceof Function) {
        successHandler(response, request);
      }
      return;
    }

    try {
      let response,
        url = CONFIG.endpoint + "tokens?format=json",
        request = new XMLHttpRequest(),
        formData = new FormData();

      for (let param in context) {
        if (context.hasOwnProperty(param)) {
          formData.append(param, context[param]);
        }
      }

      /* TODO: Abort here if token is already expired.
       * Use tokenIsViable() to test its embedded date.
       * However, the most-proper resolution is TBD.
       */

      request.open("PUT", url, true);
      request.onreadystatechange = function () {
        if (request.readyState === 4) {
          if (request.status === 200) {
            refreshing = false;
            response = JSON.parse(request.responseText);
            if ("Token" in response && tokenIsViable(response.Token)) {
              if (cookies.setItem(cookieItems.Token, response.Token, Infinity)) {
                if ("RequestingToken" in response && "UserName" in response.RequestingToken) {
                  setUserInfo(response.RequestingToken);
                } else {
                  requestUserInfo({ UserName: response.RequestingToken.UserName, Token: response.Token });
                }
              } else {
                console.error("idmorg-auth:refreshCredentials:", "Problem writing Token cookie!");
              }
              cookies.removeItem(cookieItems.Test);
            } else {
              console.error("idmorg-auth:refreshCredentials:", "Problem getting Token from IDM API!");
            }
            if (!!successHandler && successHandler instanceof Function) {
              successHandler(response, request);
            }
          } else {
            refreshing = false;
            response = request.statusText;
            if (!!failureHandler && failureHandler instanceof Function) {
              failureHandler(response, request);
            }
          }
        }
      };
      refreshing = true;
      request.setRequestHeader(requestHeaderName, token || getToken());
      request.send(formData);
    } catch (err) {
      refreshing = false;
      console.error("idmorg-auth:refreshCredentials:", err);
      throw err;
    }
  };

  /**
   * submitCredentials is the fundamental Request to API for a token.
   * NOTE: No validation here. Supplied credentials are expected to be vetted and well-formed.
   * NOTE: By default, a successful transaction will store Token locally as a cookie.
   *
   * @public by proxy
   * @param {Object} info are { UserName:"value", Password:"value" } required for authentication.
   * @callback {Function} successHandler (optional). The Response's JSON.parse(responseText) and Request XHR are passed to this handler.
   * @callback {Function} failureHandler (optional). The Response's statusText and Request XHR are passed to this handler.
   * @callback {Function} finallyHandler (optional). Fires after all processes, regardless of success or failure.
   */
  const submitCredentials = function (info, successHandler, failureHandler, finallyHandler) {

    let response = {},
      request = new XMLHttpRequest(),
      url = CONFIG.endpoint + "tokens?format=json";

    /**
     * onFailure is a general-purpose facilitator for informing the user of error-like situations.
     * @private
     * @param {Boolean} isHandled is true whenever a callback is expected to resolve the user experience.
     * @param {String} uxMessage (optional) is any message prescribed with contextual relevance.
     */
    const onFailure = function (isHandled, uxMessage) {
      let message = "Sorry, but there was a problem with IDM authentication.";
      if (!!uxMessage) {
        message = uxMessage;
      } else if ("ResponseMessage" in response && !!response.ResponseMessage) {
        message = response.ResponseMessage;
      }
      if (!isHandled) {
        // failure handler takes precedence, then an error listener, then an alert...
        if (pubsub.isSubscribed("error")) {
          pubsub.publish("error", { Request: request, Response: response, Message: message });
        } else if (!!CONFIG.turnkeyUI) {
          alert(message);
        }
      }
      // always message the console...
      console.error("idmorg-auth:submitCredentials:", message);
    };

    // apply application configurations to credentials object
    for (let property in context) {
      if (context.hasOwnProperty(property)) {
        info[property] = context[property];
      }
    }

    // short-circuit this process when bypassing authentication (for dev)
    if (CONFIG.allowBypass && "Bypass" in info) {
      setBypassToken(info);
      if (!!successHandler && successHandler instanceof Function) {
        successHandler();
      }
      return;
    }

    try {

      request.open("POST", url, true);
      request.onreadystatechange = function () {
        if (request.readyState === 4) {
          if (!request.responseText) {
            onFailure(!!failureHandler, null);
            return;
          }

          response = JSON.parse(request.responseText);
          if (request.status === 200) {
            if ("Token" in response && tokenIsViable(response.Token)) {
              if (cookies.setItem(cookieItems.Token, response.Token, Infinity)) {
                if ("RequestingToken" in response && "UserName" in response.RequestingToken) {
                  setUserInfo(response.RequestingToken);
                } else {
                  requestUserInfo({ UserName: response.RequestingToken.UserName, Token: response.Token });
                }
                syncApplicationActivity(context.ApplicationName);
                pubsub.publish("signin", response);
              } else {
                onFailure(false, "Access requires the browser to accept cookies.");
              }
            } else {
              onFailure(!!successHandler, "Authentication cannot be verified at this time.");
            }
            cookies.removeItem(cookieItems.Test);
            if (!!successHandler && successHandler instanceof Function) {
              successHandler({ Request: request, Response: response });
            }
          } else {
            if (!!failureHandler && failureHandler instanceof Function) {
              failureHandler({ Request: request, Response: response });
            } else {
              switch (request.status) {
                case 401:
                  onFailure(false, "The supplied credentials do not match a registered account.");
                  break;
                default:
                  onFailure(false, "Authentication cannot be verified at this time.");
              }
            }
          }
        }
        if (!!finallyHandler && finallyHandler instanceof Function) {
          finallyHandler();
        }
      };
      request.setRequestHeader("Content-Type", "application/json");
      request.send(JSON.stringify(info));
    } catch (err) {
      console.error("idmorg-auth:submitCredentials:", err);
      throw err;
    }
  };

  /**
   * submitPasswordReset is the fundamental Request to API for a token.
   * NOTE: No validation here. Supplied value is expected to be vetted and well-formed.
   *
   * @public by proxy
   * @param {Object} info is { Email:"value" } assumed to be a registered address.
   * @callback {Function} successHandler (optional). The Response's JSON.parse(responseText) and Request XHR are passed to this handler.
   * @callback {Function} failureHandler (optional). The Response's statusText and Request XHR are passed to this handler.
   * @callback {Function} finallyHandler (optional). Fires after all processes, regardless of success or failure.
   */
  const submitPasswordReset = function (info, successHandler, failureHandler, finallyHandler) {

    let response = {},
      request = new XMLHttpRequest(),
      url = CONFIG.endpoint + "/passwords/" + info.Email,
      message = "";

    const softReset = function ()  {
      let form = document.forms[formAction.passwordReset];
      form.querySelector("input[name=emailConfirm]").value = "";
      form.querySelector("input[name=email]").focus();
      form.querySelector("input[type=submit]").removeAttribute("disabled");
    };

    try {

      request.open("POST", url, true);
      request.onreadystatechange = function () {
        if (request.readyState === 4) {
          if (!request.responseText) {
            onFailure(!!failureHandler, null);
            return;
          }
          response = JSON.parse(request.responseText);
          if (request.status === 200) {
            if (!!successHandler && successHandler instanceof Function) {
              successHandler({ Request: request, Response: response });
            } else {
              if (!!CONFIG.turnkeyUI) {
                message = "An email will be sent to you with instructions for you to follow.";
                if (pubsub.isSubscribed("success")) {
                  pubsub.publish("success", { Request: request, Response: response, Message: message });
                } else {
                  alert(message);
                }
                document.forms[formAction.passwordReset].reset();
              }
            }
          } else {
            /* The request.status is likely to be a 403 (Forbidden) */
            if (!!failureHandler && failureHandler instanceof Function) {
              failureHandler({ Request: request, Response: response });
            } else {
              message = "The given email address is unrecognized. Please try again.";
              if (pubsub.isSubscribed("error")) {
                pubsub.publish("error", { Request: request, Response: response, Message: message });
                softReset();
              } else if (!!CONFIG.turnkeyUI) {
                alert(message);
                softReset();
              } else {
                if (window.confirm("The given email address is unrecognized. \nWould you like to try again?")) {
                  softReset();
                } else {
                  document.forms[formAction.passwordReset].reset();
                }
              }
            }
          }
        }
        if (!!finallyHandler && finallyHandler instanceof Function) {
          finallyHandler();
        }
      };
      request.setRequestHeader("Content-Type", "application/json");
      request.send(JSON.stringify(context));
    } catch (err) {
      console.error("idmorg-auth:submitPasswordReset:", err);
      throw err;
    }
  };

  /**
   * submitPasswordChange is the fundamental Request to API for a token.
   * NOTE: No validation here. Supplied credentials are expected to be vetted and well-formed.
   * NOTE: By default, a successful transaction will store Token locally as a cookie.
   *
   * 1. Form field requirements and patterns are first hurdle for input.
   * 2. submitCredentials() validates "Current Password" input.
   * 3. If "Current Password" is valid, "New Password" is PUT for update.
   * 4. If success, we are done, else message as appropriate.
   *
   * @public by proxy
   * @param {Object} info are { UserName:"value", Password:"value", PasswordCandidate:"value" } required for authentication and update.
   * @callback {Function} successHandler (optional). The Response's JSON.parse(responseText) and Request XHR are passed to this handler.
   * @callback {Function} failureHandler (optional). The Response's statusText and Request XHR are passed to this handler.
   * @callback {Function} finallyHandler (optional). Fires after all processes, regardless of success or failure.
   */
  const submitPasswordChange = function (info, successHandler, failureHandler, finallyHandler) {

    let response = {},
      request = new XMLHttpRequest(),
      url = CONFIG.endpoint + "users/" + info.UserName + "?format=json",
      formData = new FormData(),
      message;

    const onFailure = function () {
      /* TODO: customize failure responses per condition? */
      if ("ResponseMessage" in response && !!response.ResponseMessage) {
        message = response.ResponseMessage;
      } else {
        message = "Oops. The password could NOT be changed. Please try again.";
      }
      if (pubsub.isSubscribed("error")) {
        pubsub.publish("error", { Request: request, Response: response, Message: message });
      } else {
        alert(message);
      }
      try {
        document.forms["passwordChange"].querySelectorAll("INPUT[name^=Password]").forEach(function(input){input.value="";});
      } catch (err) {
        console.error("idmorg-auth:submitPasswordChange:", err);
      }
      console.error("idmorg-auth:submitPasswordChange:", request, response);
    };

    try {

      submitCredentials(
        info,
        function(submitRequest, submitResponse) {
          /* SUCCESSFUL SIGNIN, so submit the new password... */

          // CREATE a data package for the new value...
          formData.append("Password", info["PasswordCandidate"]);

          // APPLY context variables...
          for (let param in context) {
            if (context.hasOwnProperty(param)) {
              formData.append(param, context[param]);
            }
          }

          // PUT the new value...
          request.open("PUT", url, true);
          request.onreadystatechange = function () {
            if (request.readyState === 4) {
              if (!request.responseText) {
                onFailure(!!failureHandler, null);
                return;
              }
              response = JSON.parse(request.responseText);
              if (request.status === 200) {
                if (!!successHandler && successHandler instanceof Function) {
                  successHandler({ Request: request, Response: response });
                } else {
                  if (!!CONFIG.turnkeyUI) {
                    element.classList.add("authentic");
                    message = "The password has been changed successfully!";
                    if (pubsub.isSubscribed("success")) {
                      pubsub.publish("success", { Request: request, Response: response, Message: message });
                    } else {
                      alert(message);
                    }
                    document.forms[formAction.passwordChange].reset();
                  }
                }
              } else {
                if (!!failureHandler && failureHandler instanceof Function) {
                  failureHandler({ Request: request, Response: response });
                } else {
                  onFailure();
                }
              }
            }
          };
          request.setRequestHeader(requestHeaderName, getToken());
          request.send(formData);
        },
        function() {
          /* FAILED SIGNIN */
          onFailure();
        },
        function() {
          if (!!finallyHandler && finallyHandler instanceof Function) {
            finallyHandler();
          }
        }
      );
    } catch (err) {
      onFailure();
      throw err;
    }
  };

  /**
   * extractAndValidateCredentials gleans credentials as required for API.
   *
   * @private
   * @param {Object} obj is the form.elements[param].value or data containing the credentials.
   * @return {Object|null} when found and valid, credentials are supplied as needed.
   */
  const extractAndValidateCredentials = function (obj) {
    let un, pw, pwc, bp, em, info = {};
    const extractValue = function (src) {
      if (typeof src === "string" || src instanceof String) {
        return src;
      } else if ("value" in src) {
        return src["value"];
      } else if ("getAttribute" in src) {
        return src.getAttribute("value")
      } else {
        return "";
      }
    };
    for (let param in obj) {
      if (obj.hasOwnProperty(param)) {
        let prop = param;
        if (/^\d*$/.test(param)
          && "name" in obj[param]
          && "value" in obj[param]
          && (typeof obj[param]["value"] !== "undefined")) {
          prop = obj[param]["name"];
        }
        if (!un && /username/i.test(prop)) {
          un = extractValue(obj[prop]);
          if (/^[a-zA-Z][a-zA-Z0-9-_.]{2,50}$/.test(un)) {
            info["UserName"] = un;
            un = true;
          }
        }
        if (!pw && /password/i.test(prop) && !/confirm|new|candidate/i.test(prop)) {
          pw = extractValue(obj[prop]);
          if (/^[^\x22]{5,256}$/.test(pw)) {
            info["Password"] = btoa(pw);
            pw = true;
          }
        }
        if (!pwc && /password/i.test(prop) && /confirm|new|candidate/i.test(prop)) {
          pwc = extractValue(obj[prop]);
          if (/^[^\x22]{5,256}$/.test(pwc)) {
            info["PasswordCandidate"] = btoa(pwc);
            pwc = true;
          }
        }
        if (!bp && /bypass/i.test(prop) && CONFIG.allowBypass) {
          bp = extractValue(obj[prop]);
          if (/1|true|checked/i.test(bp)) {
            info["Bypass"] = true;
            bp = true;
          }
        }
        if (!em && /email/i.test(prop)) {
          em = extractValue(obj[prop]);
          if (/^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(em)) {
            /* @see https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/email#Validation */
            info["Email"] = em;
            em = true;
          }
        }
      }
    }
    if ("UserName" in info && "Password" in info) {
      return info;
    } else if ("Email" in info) {
      return info;
    } else {
      return null;
    }
  };

  /* USER-INTERFACE */

  /**
   * clickHandler is a general-purpose event handler prescribed for anchor elements.
   * NOTE: Implementation of classList accommodates limitations of IE.
   *
   * @private
   * @param {Event} event
   * @return {Boolean} false if canceled.
   */
  const clickHandler = function (event) {
    let rel, aside, target = event.target || event.srcElement || null;
    if (target.nodeType && target.nodeType == 3) {
      target = target.parentNode;
    }
    if (!!target && target.nodeName == "A") {
      event.preventDefault();
      event.stopPropagation();
      if (!!element) {
        rel = target.getAttribute("REL").split(/\s+/);
        aside = element.querySelector("ASIDE");
        if (!aside.classList.contains("back")) {
          aside.classList.remove(formAction.passwordChange);
          aside.classList.remove(formAction.passwordReset);
        }
        for (let i = 0; i < rel.length; i++) {
          if (rel[i].length>0) {
            aside.classList.toggle(rel[i]);
            if (rel[i] in formAction) {
              document.forms[formAction[rel[i]]].querySelector("INPUT:not([readonly])").focus();
            }
          }
        }
      }
    }
    return true;
  };

  /**
   * releaseHandler is a special-purpose event handler prescribed for password inputs.
   *
   * @private
   * @param {Event} event
   * @return {Boolean} false if canceled.
   */
  const releaseHandler = function (event) {
    event.preventDefault();
    event.stopPropagation();
    event.target.removeEventListener("mouseup", releaseHandler);
    event.target.removeEventListener("mouseleave", releaseHandler);
    element.querySelectorAll("INPUT[name^=Password]").forEach(function(input){input.type="password";});
    return true;
  };

  /**
   * pressHandler is a general-purpose event handler prescribed for mousedown events.
   *
   * @private
   * @param {Event} event
   * @return {Boolean} false if canceled.
   */
  const pressHandler = function (event) {
    let rel, aside, target = event.target || event.srcElement || null;
    if (/svg/i.test(target.nodeName)) { target = target.parentNode; }
    if (!!target && target.nodeName == "I") {
      event.preventDefault();
      event.stopPropagation();
      target.previousSibling.setAttribute("type", "text");
      target.addEventListener("mouseup", releaseHandler);
      target.addEventListener("mouseleave", releaseHandler);
    }
    return true;
  };

  /**
   * bypassHandler is a specific form element event handler for turnkeyUI.
   * @private
   * @param {Event} event
   * @return {Boolean} false if canceled.
   */
  const bypassHandler = function (event) {
    let ele = document.getElementById("idmauthbypass");
    ele.value = !!ele.checked && CONFIG.allowBypass ? 1 : 0;
    return true;
  };

  /**
   * resetHandler is general-purpose form event handler for turnkeyUI.
   * NOTE: Implementation of classList accommodates limitations of IE.
   *
   * @private
   * @param {Event} event
   * @return {Boolean} false if canceled or when no event.
   */
  const resetHandler = function (event) {
    if (!!element) {
      enableUI();
    }
    if (!!event) {
      if (element.classList.contains("authentic")) {
        dismissUI();
      } else {
        let aside = element.querySelector("ASIDE");
        aside.classList.remove(formAction.passwordChange);
        aside.classList.remove(formAction.passwordReset);
        aside.classList.remove("back");
        document.forms[formAction.submitCredentials].querySelector("INPUT").focus();
      }
      return true;
    }
    return false;
  };

  /**
   * submitHandler is general-purpose form event handler for turnkeyUI.
   * @private
   * @param {Event} event
   * @return {Boolean} false if cancelled.
   */
  const submitHandler = function (event) {
    if (!!event && "target" in event) {
      event.stopPropagation();
      event.preventDefault();
      let info, elements, form = event.target;
      while (!/FORM/i.test(form.nodeName) && "parentNode" in form) {
        form = form.parentNode;
      }
      elements = "elements" in form ? form.elements : {};
      info = extractAndValidateCredentials(elements);
      if (!!info) {
        disableUI();
        switch (form.getAttribute("action")) {
          case formAction.submitCredentials:
            submitCredentials(info, dismissUI, null, enableUI);
            break;
          case formAction.passwordReset:
            submitPasswordReset(info);
            break;
          case formAction.passwordChange:
            submitPasswordChange(info);
            break;
        }
        return true;
      }
      form.reset();
    }
    return false;
  };

  /**
   * dispatchUI injects and then displays CSS+HTML form for signin.
   * NOTE: Implementation of classList accommodates limitations of IE.
   *
   * @private
   * @param {String} formActive (optional) is the formAction to show ("submitCredentials" when null).
   * @return {null}
   */
  const dispatchUI = function (formActive) {
    if (!styles) {
      // once appended, styles will persist
      styles = appendStyles(UI.CSS);
    }
    if (!element) {
      element = appendMarkup(UI.HTML, function (ele) {
        element.addEventListener("click", clickHandler, false);
        element.addEventListener("reset", resetHandler, false);
        element.addEventListener("submit", submitHandler, false);
        if (CONFIG.passwordPeek) {
          element.addEventListener("mousedown", pressHandler, false);
        } else {
          element.querySelectorAll("i.peek").forEach(function(icon) {
            icon.classList.add("ignore");
          });
        }
        if (CONFIG.allowBypass) {
          element.querySelector("[for=idmauthbypass]").style.display = "inline-block";
          document.getElementById("idmauthbypass").addEventListener("change", bypassHandler);
        }
        if (!!formActive && formActive in formAction) {
          element.querySelector("ASIDE").classList.add(formAction[formActive]);
          element.querySelector("ASIDE").classList.add("back");
          document.forms[formActive].querySelector("INPUT:not([readonly])").focus();
        } else {
          document.forms[formAction.submitCredentials].querySelector("INPUT").focus();
        }
        if (tokenIsViable()) {
          element.classList.add("authentic");
        }
        element.classList.add("active");
        pubsub.publish("prompt", element);
      });
    } else {
      setTimeout(function () {
        if (!!element) {
          element.classList.add("active");
          pubsub.publish("prompt", element);
        }
      }, 500);
    }
  };

  /**
   * dismissUI hides and then removes HTML signin form.
   * NOTE: Implementation of classList accommodates limitations of IE.
   * NOTE: CSS styles will persist.
   *
   * @private
   * @return {null}
   */
  const dismissUI = function () {
    if (!!element) {
      if (element.classList.contains("authentic")) {
        element.querySelector("ASIDE").classList.remove("idmauth-flip");
      }
      element.classList.remove("active");
      element.removeEventListener("click", clickHandler);
      element.removeEventListener("reset", resetHandler);
      element.removeEventListener("submit", submitHandler);
      document.getElementById("idmauthbypass").removeEventListener("change", bypassHandler);
      setTimeout(function () {
        removeMarkup(element);
        element = null;
      }, 400);
    }
  };

  /**
   * disableUI prevents interactivity during asynchronous events.
   *
   * @private
   * @return {null}
   */
  const disableUI = function () {
    if (!!element) {
      let submits = element.querySelectorAll("INPUT[type=submit]");
      submits.forEach(function(submit) {
        submit.setAttribute("disabled", "disabled");
      });
    }
  };

  /**
   * enableUI restores interactivity following asynchronous events.
   *
   * @private
   * @return {null}
   */
  const enableUI = function () {
    if (!!element) {
      let submits = element.querySelectorAll("INPUT[type=submit]");
      submits.forEach(function(submit) {
        submit.removeAttribute("disabled");
      });
    }
  };

  const UI = {
    HTML: {
      "element": "ins",
      "childNodes":[
        {
          "element": "aside",
          "attributes": {
            "class": "idmauth-flip"
          },
          "childNodes": [
            {
              "element": "form",
              "attributes": {
                "class": "front",
                "name": formAction.submitCredentials,
                "action": formAction.submitCredentials,
                "method": "POST",
                "spellcheck": "false",
                "autocomplete": "off"
              },
              "childNodes": [
                {
                  "element": "fieldset",
                  "childNodes": [
                    {
                      "element": "legend",
                      "content": "Sign into IDM"
                    }, {
                      "element": "label",
                      "content": "Username"
                    }, {
                      "element": "input",
                      "attributes": {
                        "type": "text",
                        "name": "UserName",
                        "value": "",
                        "pattern": "^[a-zA-Z][a-zA-Z0-9-_\\.]{1,}$",
                        "title": "Usernames must be alphanumeric (plus dots or underscores) and at least 3 characters (e.g. j_doe)",
                        "required": "required",
                        "tabindex": 0
                      }
                    }, {
                      "element": "label",
                      "content": "Password"
                    }, {
                      "element": "input",
                      "attributes": {
                        "type": "password",
                        "name": "Password",
                        "value": "",
                        "pattern": "^[^\\x22]{5,256}$",
                        "title": "Passwords must be 5-256 characters long and cannot contain a double-quote character!",
                        "autocomplete": "current-password",
                        "required": "required",
                        "tabindex": 0
                      }
                    }, {
                      "element": "i",
                      "attributes": {
                        "class": "peek",
                        "title": "show password"
                      },
                      "childNodes": [
                        {
                          "element": "svg",
                          "ns": "http://www.w3.org/2000/svg",
                          "attributes": {
                            "xmlns": "http://www.w3.org/2000/svg",
                            "width": "28",
                            "height": "28",
                            "viewBox": "-4 -4 32 32"
                          },
                          "childNodes": [
                            {
                              "element": "path",
                              "ns": "http://www.w3.org/2000/svg",
                              "attributes": {
                                "class": "solid",
                                "d": "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
                              }
                            }
                          ]
                        }
                      ]
                    }, {
                      "element": "nav",
                      "childNodes": [
                        {
                          "element": "a",
                          "content": "forgot",
                          "attributes": {
                            "rel": "back " + formAction.passwordReset,
                            "title": "click to reset password"
                          }
                        }, {
                          "element": "a",
                          "content": "change",
                          "attributes": {
                            "rel": "back " + formAction.passwordChange,
                            "title": "click to change password"
                          }
                        }
                      ]
                    }, {
                      "element": "input",
                      "attributes": {
                        "type": "submit",
                        "value": "Sign In",
                        "title": "Sign into IDM",
                        "formaction": formAction.submitCredentials,
                        "tabindex": 0
                      }
                    }, {
                      "element": "label",
                      "attributes": {
                        "title": "Bypass Authentication",
                        "for": "idmauthbypass"
                      },
                      "childNodes": [
                        {
                          "element": "input",
                          "attributes": {
                            "type": "checkbox",
                            "id": "idmauthbypass",
                            "name": "idmauthbypass",
                            "value": 1,
                            "checked": "checked",
                            "tabindex": -1
                          }
                        }, {
                          "element": "span",
                          "content": "Bypass Authentication"
                        }
                      ]
                    }, {
                      "element": "details",
                      "attributes": {
                        "open": "open"
                      },
                      "childNodes": [
                        {
                          "element": "summary",
                          "content": "Note"
                        }, {
                          "element": "p",
                          "content": "Permission from IDM is a prerequisite to access."
                        }
                      ]
                    }
                  ]
                }
              ]
            }, {
              "element": "form",
              "attributes": {
                "class": "back",
                "name": formAction.passwordReset,
                "action": formAction.passwordReset,
                "method": "POST",
                "spellcheck": "false",
                "autocomplete": "off"
              },
              "childNodes": [
                {
                  "element": "fieldset",
                  "childNodes": [
                    {
                      "element": "legend",
                      "content": "Reset Password"
                    }, {
                      "element": "label",
                      "content": "A Registered Email Address"
                    }, {
                      "element": "input",
                      "attributes": {
                        "type": "email",
                        "name": "email",
                        "value": "",
                        "title": "Please provide a well-formed email address.",
                        "required": "required",
                        "tabindex": 0,
                        "oninput": "this.form.emailConfirm.pattern=this.value.replace(/./g,'\\$&')"
                      }
                    }, {
                      "element": "label",
                      "content": "Confirm the Email Address"
                    }, {
                      "element": "input",
                      "attributes": {
                        "type": "email",
                        "name": "emailConfirm",
                        "value": "",
                        "title": "The email address and its confirmation must match!",
                        "required": "required",
                        "tabindex": 0
                      }
                    }, {
                      "element": "input",
                      "attributes": {
                        "type": "submit",
                        "value": "Reset Password",
                        "title": "Reset IDM Password",
                        "formaction": formAction.passwordReset,
                        "tabindex": 0
                      }
                    }, {
                      "element": "input",
                      "attributes": {
                        "type": "reset",
                        "value": "×",
                        "title": "Cancel Reset",
                        "formaction": formAction.passwordReset,
                        "tabindex": 0
                      }
                    }, {
                      "element": "details",
                      "attributes": {
                        "open": "open"
                      },
                      "childNodes":
                        [{
                          "element": "summary",
                          "content": "Note"
                        }, {
                          "element": "p",
                          "content": "An email will be sent to you with instructions for you to follow."
                        }]
                    }
                  ]
                }
              ]
            }, {
              "element": "form",
              "attributes": {
                "class": "back",
                "name": formAction.passwordChange,
                "action": formAction.passwordChange,
                "method": "PUT",
                "spellcheck": "false",
                "autocomplete": "off"
              },
              "childNodes": [
                {
                  "element": "fieldset",
                  "childNodes": [
                    {
                      "element": "legend",
                      "content": "Change Password"
                    }, {
                      "element": "label",
                      "content": "UserName"
                    }, {
                      "element": "input",
                      "attributes": {
                        "type": "text",
                        "name": "UserName",
                        "value": "",
                        "pattern": "^[a-zA-Z][a-zA-Z0-9-_\\.]{1,}$",
                        "title": "Usernames must be alphanumeric (plus dots or underscores) and at least 3 characters (e.g. j_doe)",
                        "required": "required",
                        "tabindex": 0
                      }
                    }, {
                      "element": "label",
                      "content": "Current Password"
                    }, {
                      "element": "input",
                      "attributes": {
                        "type": "password",
                        "name": "Password",
                        "value": "",
                        "pattern": "^[^\\x22]{5,256}$",
                        "title": "Passwords must be 5-256 characters long and cannot contain a double-quote character!",
                        "autocomplete": "current-password",
                        "required": "required",
                        "tabindex": 0
                      }
                    }, {
                      "element": "i",
                      "attributes": {
                        "class": "peek",
                        "title": "show password"
                      },
                      "childNodes": [
                        {
                          "element": "svg",
                          "ns": "http://www.w3.org/2000/svg",
                          "attributes": {
                            "xmlns": "http://www.w3.org/2000/svg",
                            "width": "28",
                            "height": "28",
                            "viewBox": "-4 -4 32 32"
                          },
                          "childNodes": [
                            {
                              "element": "path",
                              "ns": "http://www.w3.org/2000/svg",
                              "attributes": {
                                "class": "solid",
                                "d": "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
                              }
                            }
                          ]
                        }
                      ]
                    }, {
                      "element": "label",
                      "content": "New Password"
                    }, {
                      "element": "input",
                      "attributes": {
                        "type": "password",
                        "name": "PasswordCandidate",
                        "value": "",
                        "pattern": "^[^\\x22]{5,256}$",
                        "title": "Passwords must be 5-256 characters long and cannot contain a double-quote character!",
                        "autocomplete": "new-password",
                        "required": "required",
                        "tabindex": 0,
                        "oninput": "this.form.PasswordConfirm.pattern=this.value.replace(/\\x5b|\\x5c|\\x5e|\\x24|\\x2E|\\x7c|\\x3F|\\x2A|\\x2B|\\x28|\\x29/g,'\\x5c\$&')"
                      }
                    }, {
                      "element": "i",
                      "attributes": {
                        "class": "peek",
                        "title": "show password"
                      },
                      "childNodes": [
                        {
                          "element": "svg",
                          "ns": "http://www.w3.org/2000/svg",
                          "attributes": {
                            "xmlns": "http://www.w3.org/2000/svg",
                            "width": "28",
                            "height": "28",
                            "viewBox": "-4 -4 32 32"
                          },
                          "childNodes": [
                            {
                              "element": "path",
                              "ns": "http://www.w3.org/2000/svg",
                              "attributes": {
                                "class": "solid",
                                "d": "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
                              }
                            }
                          ]
                        }
                      ]
                    }, {
                      "element": "label",
                      "content": "Confirm New Password"
                    }, {
                      "element": "input",
                      "attributes": {
                        "type": "password",
                        "name": "PasswordConfirm",
                        "value": "",
                        "title": "The new password and its confirmation must match!",
                        "autocomplete": "new-password",
                        "required": "required",
                        "tabindex": 0
                      }
                    }, {
                      "element": "i",
                      "attributes": {
                        "class": "peek",
                        "title": "show password"
                      },
                      "childNodes": [
                        {
                          "element": "svg",
                          "ns": "http://www.w3.org/2000/svg",
                          "attributes": {
                            "xmlns": "http://www.w3.org/2000/svg",
                            "width": "28",
                            "height": "28",
                            "viewBox": "-4 -4 32 32"
                          },
                          "childNodes": [
                            {
                              "element": "path",
                              "ns": "http://www.w3.org/2000/svg",
                              "attributes": {
                                "class": "solid",
                                "d": "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
                              }
                            }
                          ]
                        }
                      ]
                    }, {
                      "element": "input",
                      "attributes": {
                        "type": "submit",
                        "value": "Change Password",
                        "title": "Change IDM Password",
                        "formaction": formAction.passwordChange,
                        "tabindex": 0
                      }
                    }, {
                      "element": "input",
                      "attributes": {
                        "type": "reset",
                        "value": "×",
                        "title": "Reset This Form",
                        "formaction": formAction.passwordChange,
                        "tabindex": 0
                      }
                    }, {
                      "element": "details",
                      "attributes": {
                        "open": "open"
                      },
                      "childNodes":
                        [{
                          "element": "summary",
                          "content": "Note"
                        }, {
                          "element": "p",
                          "content": "Passwords must be 5 to 256 characters long and cannot contain a double-quote."
                        }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    CSS: {
      "ins": {
        "position": "absolute",
        "z-index": /CONFIG.zIndex/,
        "background": "rgba(0,0,0,0.4)",
        "top": 0,
        "bottom": 0,
        "left": 0,
        "right": 0,
        "text-decoration": "none"
      },
      "aside": {
        "position": "relative",
        "width": "288px",
        "margin": "0 auto",
        "top": "-700px",
        "background": "transparent",
        "transition": "all 300ms ease",
        "cursor": "default"
      },
      "form": {
        "position": "absolute",
        "margin": 0,
        "padding": 0,
        "background": "#fafbfc",
        "border": "3px solid white",
        "box-shadow": "0 4px 32px rgba(0,0,0,0.5)"
      },
      "fieldset": {
        "margin": "20px",
        "padding": "20px",
        "border": "none",
        "font": "unset",
        "font-family": "sans-serif",
        "color": "darkslategray"
      },
      "legend": {
        "color": "orangered",
        "margin": 0,
        "border": "none",
        "text-align": "left",
        "font": "unset",
        "font-family": "inherit",
        "font-size": "1.2em",
        "line-height": 1.5
      },
      "label": {
        "display": "block",
        "margin": 0,
        "color": "#8eacc7",
        "font": "unset",
        "text-align": "left",
        "font-family": "inherit",
        "font-size": "1em",
        "line-height": 1.5
      },
      "label>span": {
        "font": "inherit",
        "color": "inherit",
        "line-height": 2
      },
      "label[for=idmauthbypass]": {
        "display": "none"
      },
      "nav": {
        "margin": "-0.7em 0 2em 0",
        "display": "flex",
        "justify-content": "space-between"
      },
      "form.back nav": {
        "margin": "1em 0 0 0"
      },
      "nav>a": {
        "cursor": "pointer",
        "font-variant": "small-caps",
        "font-size": "14px",
        "line-height": 1.1,
        "color": "#0072a2",
        "text-decoration": "none",
        "border-bottom": "1px dotted #98B3cc"
      },
      "nav>a:hover": {
        "color": "orangered",
        "border-color": "#0072a2"
      },
      "nav>a:active": {
        "color": "#0072a2"
      },
      "input": {
        "display": "block",
        "font": "unset",
        "font-family": "inherit",
        "font-size": "1em",
        "line-height": 1,
        "color": "inherit"
      },
      "input:focus": {
        "box-shadow": "0 0 12px rgba(82, 168, 236, 0.6)"
      },
      "input[type=checkbox]": {
        "display": "inline-block",
        "vertical-align": "baseline",
        "margin": "0 7px"
      },
      "input[type=text],input[type=password],input[type=email]": {
        "display": "inline-block",
        "width": "205px",
        "margin": "0 0 1em 0",
        "padding": "5px",
        "text-align": "left",
        "box-sizing": "border-box",
        "border-width": "1px"
      },
      "input[type=text]:invalid,input[type=password]:invalid,input[type=email]:invalid": {
        "color": "orangered !important",
        "border-color": "orangered !important"
      },
      "i.peek": {
        "display": "inline-block",
        "position": "absolute",
        "width": "1em",
        "height": "1em",
        "margin-left": "-2em",
        "vertical-align": "middle",
        "cursor": "pointer"
      },
      "svg path": {
        "pointer-events": "none"
      },
      "svg .solid": {
        "fill": "rgba(0,0,0,0.2)"
      },
      "i.peek:hover svg .solid": {
        "fill": "#0072a2"
      },
      "input[type=submit]": {
        "width": "205px",
        "height": "2.5em",
        "margin": "1em auto 0",
        "padding": 0,
        "box-sizing": "border-box",
        "text-transform": "uppercase",
        "font-size": "1em",
        "color": "white",
        "background-color": "#0072a2",
        "border": "1px solid #006089",
        "cursor": "pointer"
      },
      "input[type=submit]:hover": {
        "color": "#21374c",
        "background-color": "#00b3ff"
      },
      "input[type=submit]:active": {
        "color": "white",
        "background-color": "#004766"
      },
      "input[type=reset]": {
        "position": "absolute",
        "top": "20px",
        "right": "20px",
        "padding": "0 0.3em",
        "font-size": "larger",
        "line-height": 1,
        "cursor": "pointer"
      },
      "input[readonly],input[disabled]": {
        "background": "whitesmoke",
        "border": "1px solid #8eacc7",
        "color": "#8eacc7",
        "cursor": "default"
      },
      "div#.active aside": {
        "top": "40px"
      },
      "details": {
        "display": "block",
        "margin": "1em 0 0 0",
        "padding": "1em 0 0 0",
        "border": "none",
        "border-top": "1px dotted #0072a2",
        "color": "orangered"
      },
      "details summary": {
        "display": "block"
      },
      "details p": {
        "margin": "1em 0 0 0",
        "line-height": 1.3
      },
      "aside.idmauth-flip": {
        "-webkit-perspective": "1500px",
        "-moz-perspective": "1500px",
        "perspective": "1500px",
        "-ms-perspective": "none"
      },
      "aside.idmauth-flip>.front, aside.idmauth-flip>.back": {
        "-webkit-transition": "all 400ms ease",
        "-moz-transition": "all 400ms ease",
        "-ms-transition": "all 400ms ease",
        "transition": "all 400ms ease",
        "-webkit-backface-visibility": "hidden",
        "-moz-backface-visibility": "hidden",
        "-ms-backface-visibility": "hidden",
        "backface-visibility": "hidden"
      },
      "aside.idmauth-flip>.front": {
        "z-index": 99
      },
      "aside.idmauth-flip>.back": {
        "-webkit-transform": "rotateY(-180deg)",
        "-moz-transform": "rotateY(-180deg)",
        "-ms-transform": "rotateY(-180deg)",
        "transform": "rotateY(-180deg)",
        "z-index": 98
      },
      "aside.idmauth-flip.back>.front": {
        "-webkit-transform": "rotateY(180deg)",
        "-moz-transform": "rotateY(180deg)",
        "-ms-transform": "rotateY(180deg)",
        "transform": "rotateY(180deg)",
        "z-index": 98
      },
      "aside.idmauth-flip.back>.back": {
        "-webkit-transform": "rotateY(0deg)",
        "-moz-transform": "rotateY(0deg)",
        "-ms-transform": "rotateY(0deg)",
        "transform": "rotateY(0eg)",
        "z-index": 99
      },
      "aside.passwordChange>form[action=passwordReset]": {
        "display": "none"
      },
      "aside.passwordChange>form[action=passwordChange]": {
        "display": "block"
      },
      "aside.passwordReset>form[action=passwordChange]": {
        "display": "none"
      },
      "aside.passwordReset>form[action=passwordReset]": {
        "display": "block"
      },
      ".ignore": {
        "display": "none !important"
      }
    }
  };

  /**
   * appendStyles parses JSON-formatted styles into CSS.
   * @todo support media queries, import
   *
   * @private
   * @param {JSON} jsonStyles is objectified CSS rules.
   * @return {Element} the style element as appended to DOM
   */
  const appendStyles = function (jsonStyles) {
    const parseStyles = function (json) {
      const parseRules = function (rules) {
        let css = [];
        for (let rule in rules) {
          if (/\/CONFIG\./.test(rules[rule])) {
            rules[rule] = CONFIG[rules[rule].toString().replace(/\/CONFIG\.(.+)\//, "$1")];
          }
          if (/^(to|from|\d+%)$/.test(rule)) {
            css.push("\t" + rule + " { " + rules[rule] + " }");
          } else {
            css.push("\t" + rule + ": " + rules[rule] + ";");
          }
        }
        return css.join("\n");
      }
      let css = [], scope = "div#" + markupId;
      for (let selector in json) {
        if (/^@.*keyframes/.test(selector)) {
          css.push(selector + "\n{\n" + parseRules(json[selector]) + "\n}\n");
        } else if (/div#/.test(selector)) {
          css.push(selector.replace(/div#/g, scope) + "\n{\n" + parseRules(json[selector]) + "\n}\n");
        } else {
          css.push(selector.replace(/(^|,)\s*(\b)/g, "$1"+scope+" $2") + "\n{\n" + parseRules(json[selector]) + "\n}\n");
        }
      }
      return css.join("\n");
    };

    let styleElement = document.createElement("style");
    styleElement.setAttribute("type", "text/css");
    styleElement.appendChild(document.createTextNode(""));
    styleElement.appendChild(document.createTextNode(parseStyles(jsonStyles)));

    document.head.appendChild(styleElement);
    return styleElement;
  };

  /**
   * appendMarkup parses JSON-formatted markup into HTML
   *
   * @private
   * @param {JSON} jsonMarkup
   * @param {Function} doneHandler will fire after appending to the DOM.
   */
  const appendMarkup = function (jsonMarkup, doneHandler) {
    const parseMarkup = function (root, parent) {
      if ("element" in root) {
        let ele;
        if ("ns" in root) {
          ele = document.createElementNS(root.ns, root.element);
        } else {
          ele = document.createElement(root.element);
        }
        if ("content" in root) {
          ele.appendChild(document.createTextNode(root.content));
        }
        if ("attributes" in root) {
          for (let attribute in root.attributes) {
            ele.setAttribute(attribute, root.attributes[attribute]);
          }
        }
        if ("childNodes" in root) {
          for (let i = 0; i < root.childNodes.length; i++) {
            parseMarkup(root.childNodes[i], ele);
          }
        }
        parent.appendChild(ele);
      }
    };

    let observer, container = document.createElement("div");
    const observerCallback = function (mutationsList) {
      let done = false;
      mutationsList.forEach(function(mutation) {
        // the appending of html has occurred...
        if (mutation.type == "childList") {
          done = true;
        }
      });
      if (done) {
        observer.disconnect();
        if (!!doneHandler && doneHandler instanceof Function) {
          doneHandler(container);
        }
      }
    };

    if (!CONFIG.parentElement) {
      CONFIG.parentElement = document.querySelector("body");
    }

    parseMarkup(jsonMarkup, container);
    container.setAttribute("id", markupId);
    observer = new MutationObserver(observerCallback);
    observer.observe(CONFIG.parentElement, { childList: true, subtree: true, addedNodes: true });
    CONFIG.parentElement.appendChild(container);
    return container;
  };

  /**
   * removeMarkup safely removes markup
   */
  const removeMarkup = function (ele) {
    if (!!ele && "parentNode" in ele) {
      ele.parentNode.removeChild(ele);
    }
  };

  /* COOKIE MANAGEMENT */

  /**
   * enforceOpenDomain allows accessibilty across sub-domains.
   * NOTE: IP address or localhost will defer to document.cookie default (the full domain).
   * NOTE: IE does not support cookies written with an exclusive domain of "localhost" or numeric IP.
   *
   * @private
   * @return {String|null} when deployed, provides the open domain value (e/g ".idmod.org")
   */
  const enforceOpenDomain = function () {
    let ie = /trident/i.test(navigator.userAgent);
    let domain = "domain" in document ? document.domain : null;
    if (!/null|undefined|localhost/i.test(domain)) {
      if (!/^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(domain)) {
        if (domain.indexOf(".") > 0) {
          domain = domain.substr(domain.indexOf("."));
        }
      } else if (ie) {
        domain = null;
      }
    } else if (ie) {
      domain = null;
    }
    return domain;
  };

  const cookies = {

    /**
     * setItem create or overwrite a cookie of the same key.
     * @external {Boolean|String} CONFIG.localize (from the outer scope) determines scope of cookie storage.
     *
     * @public (to outer scope)
     * @param {String} key is the name of the cookie.
     * @param {String} val is the value of the cookie.
     * @param {varies} end (optional) is time till expiry, null defaults to session, or seconds (31536e3 for a year), Infinity, GMTString, Date object.
     * @param {String} path (optional) is where the cookie will be exclusively readable (e/g "/dashboard").
     * @param {String} location (optional) is where the cookie will be exclusively readable (e/g "comps.idmod.org").
     * @param {Boolean} secure (false by default) determines if cookie will be transmitted only over secure protocol as https.
     * @return {Boolean} true when a cookie has been stored, false when key is null or an illegal term (no cookie written).
     */
    setItem: function (key, val, end, path, location, secure) {

      var domain = null;

      if (!key || /^(?:expires|max\-age|path|domain|secure|true|false)$/i.test(key)) {
        return false;
      }

      if (!!CONFIG.localize && key in cookieItems) {
        domain = typeof location !== "undefined" ?  location : enforceOpenDomain();
      }

      var expires = "";
      if (end) {
        switch (end.constructor) {
          case Number:
            expires = end === Infinity ? "; expires=Fri, 31 Dec 9999 23:59:59 GMT" : "; max-age=" + end;
            break;
          case String:
            expires = "; expires=" + end;
            break;
          case Date:
            expires = "; expires=" + end.toUTCString();
            break;
        }
      }

      document.cookie = encodeURIComponent(key) + "=" + encodeURIComponent(val)
        + expires
        + (!!path ? "; path=" + path : "")
        + (!!secure ? "; secure" : "")
        + (!!domain ? "; domain=" + domain : "");

      return true;
    },

    /**
     * getItem gets a cookie's value.
     *
     * @public (to outer scope)
     * @param {String} key is the name of the cookie.
     * @param {varies} defVal is the default value when cookie is not found.
     * @return {varies} either the cookie value (String) or default.
     */
    getItem: function (key, defVal) {
      if (!key || !this.hasItem(key)) {
        return defVal || null;
      } else {
        return decodeURIComponent(document.cookie.replace(new RegExp("(?:(?:^|.*;)\\s*" + encodeURIComponent(key).replace(/[\-\.\+\*]/g, "\\$&") + "\\s*\\=\\s*([^;]*).*$)|^.*$"), "$1"));
      }
    },

    /**
     * hasItem checks the existence of a cookie of a given key.
     *
     * @public (to outer scope)
     * @param {String} key is the name of the cookie.
     * @return {Boolean} true when the cookie exists.
     */
    hasItem: function (key) {
      if (!key) {
        return false;
      } else {
        return (new RegExp("(?:^|;\\s*)" + encodeURIComponent(key).replace(/[\-\.\+\*]/g, "\\$&") + "\\s*\\=")).test(document.cookie);
      }
    },

    /**
     * removeItem expires a cookie of a given key, path, and domain.
     *
     * @public (to outer scope)
     * @param {String} key is the name of the cookie.
     * @param {String} path (optional) is where the cookie will be exclusively readable (e/g "/dashboard").
     * @param {String} domain (optional) is where the cookie will be exclusively readable (e/g "comps.idmod.org").
     * @return {null}
     */
    removeItem: function (key, path, domain) {
      if (typeof domain === "undefined" && key in cookieItems) {
        /* let domain = enforceOpenDomain(); // Will not work in IE or Edge, so don't. */
      }
      if (this.hasItem(key)) {
        document.cookie = encodeURIComponent(key)
          + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT"
          + (domain ? "; domain=" + domain : "")
          + (path ? "; path=" + path : "");
      }
      return null;
    },

    /**
     * getKeys gets all cookie names available to the document.
     *
     * @public (to outer scope)
     * @return {Array} the document's cookie names.
     */
    getKeys: function () {
      let keys = document.cookie.replace(/((?:^|\s*;)[^\=]+)(?=;|$)|^\s*|\s*(?:\=[^;]*)?(?:\1|$)/g, "").split(/\s*(?:\=[^;]*)?;\s*/);

      for (let length = keys.length, index = 0; index < length; index++) {
        keys[index] = decodeURIComponent(keys[index]);
      }
      return keys;
    },

    /**
     * toObject gets all cookie names and content as an object of key:value pairs.
     *
     * @public (to outer scope)
     * @return {Object} the document's cookie names and values.
     */
    toObject: function () {
      let items = document.cookie.split(";");
      let obj = {};

      if (items.length > 0) {
        items.forEach(function (val) {
          let i = val.split("=");
          obj[i[0].trim()] = i[1];
        });
      }
      return obj;
    },

    /**
     * toString gets all cookie names and content as literally stored.
     *
     * @public (to outer scope)
     * @return {String} the document's cookies without transformation.
     */
    toString: function () {
      return document.cookie;
    }
  };

  /* PUBLIC API */

  return {

    /**
     * init is called ONCE to instantiate this library
     *
     * @public
     * @param {Object} overrides are any name:value pairs to override defaults here.
     * @param {Boolean} headless (optional) when true, bypass all UI-related effort.
     * @example { turnkeyUI:false } initializes with assumption UI is not required.
     */
    init: function (overrides, headless) {
      if (!!overrides) {
        for (let rule in overrides) {
          if (overrides.hasOwnProperty(rule)) {
            switch (rule.toLowerCase()) {
              case "applicationname":
                context.ApplicationName = overrides[rule];
                break;
              case "clientversion":
                context.ClientVersion = overrides[rule];
                break;
              case "endpoint":
                CONFIG.endpoint = overrides[rule];
                break;
              case "allowbypass":
                CONFIG.allowBypass = !!overrides[rule];
                break;
              case "passwordpeek":
                CONFIG.passwordPeek = !!overrides[rule];
                break;
              case "turnkeyui":
                CONFIG.turnkeyUI = !!overrides[rule];
                break;
              case "localize":
                CONFIG.localize = /^false$/i.test(overrides[rule]) ? false : overrides[rule];
                break;
              case "zindex":
                if (/[1-9]\d*/.test(overrides[rule])) {
                  CONFIG.zIndex = Math.min(ZMAX, parseInt(overrides[rule]));
                }
                break;
              case "parentelement":
                if ("appendChild" in overrides[rule]) {
                  CONFIG.parentElement = overrides[rule];
                }
                break;
              default:
                console.warn("idmorg-auth:init:", "An override parameter was not recognized:", rule);
            }
          }
        }
      }

      if (!!CONFIG.localize) {
        cookieItems.localize(CONFIG.localize);
      }
      document.addEventListener("visibilitychange", handleVisibilityChange, false);

      if (!headless) {
        startSession(
          function () {
            // user is signed-in
          },
          function () {
            // user is signed-out
            if (CONFIG.turnkeyUI) {
              dispatchUI();
            }
          }
        );
      }
    },

    /**
     * precheck checks for a viable session without engaging the DOM.
     * Note: Use for a fast check, employing callback to proceed with normal init.
     * Note: init(options) are additive, so it is safe to set all here.
     *
     * @param {Object} config are any options that could be required (e/g endpoint).
     * @param {Function} callback is passed the viable token or null when session is not valid.
     */
    precheck: function(config, callback) {
      this.init(config,true);
      if (!!callback && callback instanceof Function) {
        callback(getToken(true));
      }
    },

    /**
     * getRequestHeaderName provides the sanctioned header name for an authorized XMLHttpRequest object.
     * NOTE: This header must have the value of a valid Token.
     *
     * @return {String} the requestHeaderName
     */
    getRequestHeaderName: function () {
      return requestHeaderName;
    },

    /**
     * setRequestHeaderToken prepares an XMLHttpRequest for authorized transaction.
     * NOTE: The Token could be invalid or expired, so Request must expect to perform resolution.
     * NOTE: The Request object must be OPEN to apply. With jQuery, use beforeSend(); method.
     *
     * @public
     * @param {XMLHttpRequest} xhr is the Request object requiring the Token.
     * @return {XMLHttpRequest} the modified Request object.
     */
    setRequestHeaderToken: function (xhr) {
      if (!!xhr && /object/i.test(typeof xhr) && "setRequestHeader" in xhr) {
        xhr.setRequestHeader(requestHeaderName, getToken());
      }
      return xhr;
    },

    /**
     * signin is a direct submit via code of credentials for signin.
     * NOTE: No UI-related routines are performed.
     *
     * @public
     * @param {Object} credentials are the { UserName:"value", Password:"value" } required for authentication.
     * @callback {Function} success (optional) situational routines to execute post-success.
     * @callback {Function} fail (optional) situational routines to execute post-failure.
     * @return {Boolean} false when credentials prove invalid.
     */
    signin: function (credentials, success, fail) {
      let info = extractAndValidateCredentials(credentials);
      if (!!info) {
        return submitCredentials(info, success, fail);
      } else {
        console.error("idmorg-auth:signin", "Invalid Credentials!");
        return false;
      }
    },

    /**
     * signout clears token and cookie and reinitializes this library.
     * NOTE: When this method is applied as an event handler, the first argument is an event object.
     *
     * @public
     * @param {String} override (optional) is an applicationName to quit. When null, signout is universal.
     * @callback (optional) situational routines to execute post-signout.
     */
    signout: function (override, callback) {
      let appName = /string/i.test(typeof override) ? override : null;
      endSession(appName, !!appName ? "The application session has ended." : "The IDM session has ended.");
      if (CONFIG.turnkeyUI && (appName === null || context.ApplicationName === appName)) {
        dispatchUI();
      }
      if (!!callback && callback instanceof Function) {
        callback();
      }
    },

    /**
     * signinFormAction is intended as passive submit handler of an HTML form.
     *
     * @public
     * @param {Event} event is the submit event object.
     * @return {Boolean} true when signin was successful
     */
    signinFormAction: function (event) {
      if (!!event && "target" in event) {

        event.stopPropagation();
        event.preventDefault();

        let info, form = event.target;

        // bubble-up to form element...
        while (!/FORM/i.test(form.nodeName) && "parentNode" in form) {
          form = form.parentNode;
        }

        // extract pertinent variables...
        if ("elements" in form) {
          info = extractAndValidateCredentials(form.elements);
        }

        if (!!info) {
          return submitCredentials
          (
            info,
            function () {
              // success
              return true;
            },
            function () {
              // fail
              return false;
            }
          );
        } else {
          return false;
        }
      }
    },

    /**
     * signinWithToken bypasses credentials (OAuth)
     * @public
     * @param {String} token
     */
    signinWithToken: function(response) {
      if (cookies.setItem(cookieItems.Token, response.Token, Infinity)) {
        if ("RequestingToken" in response && "UserName" in response.RequestingToken) {
          setUserInfo(response.RequestingToken);
        } else {
          requestUserInfo({ UserName: response.RequestingToken.UserName, Token: response.Token });
        }
        syncApplicationActivity(context.ApplicationName);
        pubsub.publish("signin", response);
        dismissUI();
      }
    },

    /**
     * passwordReset is intended to prompt user with the turnkeyUI.
     * @public
     * @return {null}
     */
    passwordReset: function() {
      if (CONFIG.turnkeyUI) {
        dispatchUI(formAction.passwordReset);
      }
    },

    /**
     * passwordResetFormAction is intended as passive submit handler of an HTML form.
     *
     * @public
     * @param {Event} event is the submit event object.
     * @return {Boolean} true when password reset was successful
     */
    passwordResetFormAction: function (event) {
      if (!!event && "target" in event) {

        event.stopPropagation();
        event.preventDefault();

        let info, form = event.target;

        // bubble-up to form element...
        while (!/FORM/i.test(form.nodeName) && "parentNode" in form) {
          form = form.parentNode;
        }

        // extract pertinent variables...
        if ("elements" in form) {
          info = extractAndValidateCredentials(form.elements);
        }

        if (!!info) {
          return submitPasswordReset
          (
            info,
            function () {
              // success
              return true;
            },
            function () {
              // fail
              return false;
            }
          );
        } else {
          return false;
        }
      }
    },

    /**
     * passwordChange is intended to prompt user with the turnkeyUI.
     * @public
     * @return {null}
     */
    passwordChange: function() {
      if (CONFIG.turnkeyUI) {
        dispatchUI(formAction.passwordChange);
        if (tokenIsViable()) {
          let form, field, user = getUserName();
          if (!!user) {
            form = element.querySelector("form[action="+formAction.passwordChange+"]");
            field = form.elements["UserName"];
            field.value = user;
            field.setAttribute("readonly", true);
          }
        }
      }
    },

    /**
     * passwordChangeFormAction is intended as passive submit handler of an HTML form.
     *
     * @public
     * @param {Event} event is the submit event object.
     * @return {Boolean} true when password change was successful
     */
    passwordChangeFormAction: function (event) {
      if (!!event && "target" in event) {

        event.stopPropagation();
        event.preventDefault();

        let info, form = event.target;

        // bubble-up to form element...
        while (!/FORM/i.test(form.nodeName) && "parentNode" in form) {
          form = form.parentNode;
        }

        // extract pertinent variables...
        if ("elements" in form) {
          info = extractAndValidateCredentials(form.elements);
        }

        if (!!info) {
          return submitPasswordChange
          (
            info,
            function () {
              // success
              return true;
            },
            function () {
              // fail
              return false;
            }
          );
        } else {
          return false;
        }
      }
    },

    /**
     * addEventListener subscribes a callback to a remarkable event.
     *
     * @public
     * @param {String} eventName is expected to be either "signin" or "signout".
     * @param {String|*} observer is any unique identifier. e/g "comps.context.refresh"
     * @param {Function} callback is the code to execute upon publish of event.
     * @return {null}
     */
    addEventListener: function (eventName, observer, callback) {
      pubsub.subscribe(eventName, observer, callback);
    },

    /**
     * removeEventListener unsubscribes a callback from a remarkable event.
     *
     * @public
     * @param {String} eventName is expected to be either "signin" or "signout".
     * @param {String|*} observer is any unique identifier. e/g "comps.context.refresh"
     * @param {Function} callback is the code to execute upon publish of event.
     * @return {null}
     */
    removeEventListener: function (eventName, observer, callback) {
      pubsub.unsubscribe(eventName, observer, callback);
    },

    /**
     * clearEventListeners unsubscribes all callbacks from remarkable events.
     *
     * @public
     * @return {null}
     */
    clearEventListeners: function() {
      pubsub.initialize();
    },

    /**
     * setTokenExpirationByOffset spoofs a token's "Expires" value (for dev/test).
     * NOTE: Use for Test to coerce a token into a "waning" condition that triggers refreshCredentials();
     * NOTE: This will affect token cookie for all IDM applications within a browser instance!
     *
     * @public
     * @param {Number} offset (optional) is milliseconds ago (-) or from now (+) when token expires (when null: -1).
     * @return {null}
     */
    setTokenExpirationByOffset: function (offset) {

      let expiresDate,
        token = cookies.getItem(cookieItems.Token),
        details = new Array(Math.max(tokenMap.UserName, tokenMap.Expires) + 1);

      if (arguments.length > 0 && /^\d+$/.test(offset)) {
        expiresDate = new Date(Date.now() + offset);
      } else {
        expiresDate = new Date(Date.now());
      }

      if (!!token && (typeof token === "string" || token instanceof String)) {
        details = token.split(",");
      } else {
        details[tokenMap.UserName] = "expiredUser";
      }

      details[tokenMap.Expires] = convertDateToTokenDateString(expiresDate);
      cookies.setItem(cookieItems.Test, details.join(","), Infinity);
      console.warn("idmorg-auth:expiration", expiresDate.toLocaleString(), "(Local Time)");
      console.warn("idmorg-auth:NOTE! This test token is destroyed when a new token is written!");
    },

    /**
     * getHoursUntilExpiration calculates the time remaining in current session.
     *
     * @public
     * @return {Number} the hours in time until token expires, or 0 when no token.
     */
    getHoursUntilExpiration: function () {
      let test = cookies.getItem(cookieItems.Test);
      let token = cookies.getItem(cookieItems.Token);
      let details, expiresDate;

      if (!!test) {
        details = !!test && (typeof test === "string" || test instanceof String) ? test.split(",") : [];
        if (details.length > tokenMap.Expires) {
          expiresDate = convertTokenDateStringToDate(details[tokenMap.Expires]);
        }
        console.warn("idmorg-auth:NOTE! Expiration has been manipulated via setTokenExpirationByOffset();");
        return expiresDate ? ((expiresDate.getTime() - Date.now()) / 1000 / 60 / 60).toPrecision(4) : 0;

      } else {
        details = !!token && (typeof token === "string" || token instanceof String) ? token.split(",") : [];
        if (details.length > tokenMap.Expires) {
          expiresDate = convertTokenDateStringToDate(details[tokenMap.Expires]);
        }
        return expiresDate ? ((expiresDate.getTime() - Date.now()) / 1000 / 60 / 60).toPrecision(4) : 0;
      }
    },

    /**
     * forceServiceError will alter the endpoint to force a 404 (Not Found) for test of error routines.
     *
     * @public
     * @return {Boolean} true when ready for test.
     */
    forceServiceError: function () {
      CONFIG.endpoint = "/api/x";
      console.warn("Authentication service will now fail with 404 (Not Found). Reload page to revert.");
      return true;
    },

    /**
     * corruptToken will alter the Token cookie to force a 403 (Forbidden) for test of error routines.
     * NOTE: This will affect token cookie for all IDM applications within a browser instance!
     *
     * @public
     * @return {Boolean} true when ready for test.
     */
    corruptToken: function () {
      let token = cookies.getItem(cookieItems.Token);
      if (!!token) {
        token = token.substr(1);
        cookies.setItem(cookieItems.Token, token, Infinity);
        console.warn("Authentication service will now fail with 403 (Forbidden). Reload page to revert.");
        return true;
      } else {
        console.warn("Please sign-in. A token is required.");
        return false;
      }
    },

    getActiveApplicationNames: function() {
      return syncApplicationActivity();
    },

    getMarkupId: function () {
      return markupId;
    },

    getVersion: function () {
      return version;
    },

    getAPI: function() {
      return this;
    },

    getConfig: function() {
      /* configurable options */
      return Object.assign(CONFIG, context);
    },

    /* Expose @private methods by proxy: */

    getToken: getToken,
    getUserName: getUserName,
    getParsedToken: getParsedToken,
    getUserInfo: getUserInfo,
    hasPermission: hasPermission,
    tokenIsViable: tokenIsViable,
    tokenIsWaning: tokenIsWaning,
    tokenIsExpired: tokenIsExpired,
    submitCredentials: submitCredentials,
    refreshCredentials: refreshCredentials,
    submitPasswordReset: submitPasswordReset,
    submitPasswordChange: submitPasswordChange,
    submitFormCredentials: function(formElement, successHandler, failureHandler, finallyHandler) {
      submitCredentials(extractAndValidateCredentials(formElement), successHandler, failureHandler, finallyHandler);
    },
    printListenersByEvent: function(eventName) { return pubsub.isSubscribedByWho(eventName); }
  };
})();

export default Auth;
