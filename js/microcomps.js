import { assign as assign$1, reduce, forEach, isArray, set, isString, merge, find, get, findIndex, clone } from 'lodash-es';
import axios from 'axios';

const VERSION="0.1.0";
const kDefaultBaseHostname = "comps.idmod.org";
const kDefaultDevBaseHostname = "comps-dev.idmod.org";
const kDefaultBaseUrl = "https://comps.idmod.org";
const kDefaultDevBaseUrl = "https://comps-dev.idmod.org";

const kLocalhostAliases = [
  "localhost",
  "127.0.0.1"
];

//==============================================================================
// Globals
//==============================================================================
/**
 * Global logger object to support static logging functions. By default
 * MicroCOMPS logs to the console. A replacement logger can be installed with
 * setGlobalLogger(). The replacement logger must have the same interface as
 * the JS console object.
 */
let gMicroCOMPSLogger = console;

//==============================================================================
// Logging function-API
//==============================================================================
function log$1(...args) { gMicroCOMPSLogger.log(...args); }
function logInfo$1(...args) { gMicroCOMPSLogger.info(...args); }
function logWarn(...args) { gMicroCOMPSLogger.warn(...args); }
function logError$1(...args) { gMicroCOMPSLogger.error(...args); }
function logObject(...args) { gMicroCOMPSLogger.log(...args); }
function logClear(...args) { gMicroCOMPSLogger.clear(...args); }

//------------------------------------------------------------------------------
/**
 * Set the global MicroCOMPS logger that is attached to the log*() functions.
 * @param logger
 */
function setGlobalLogger(logger) {
  gMicroCOMPSLogger = logger;
}

//------------------------------------------------------------------------------
/**
 * Returns the global logger object that handles the log*() functions.
 * @returns {*} - currently installed logger.
 */
function getGlobalLogger() {
  return gMicroCOMPSLogger;
}

//==============================================================================
// Entity
// Base class maintains:
// Data member    Description
// -------------- -----------------------------------------------------------
//   mc           MicroCOMPS instance
//   id           id of current entity
//   entityType   entityType (Simulation|Experiment|Suite|AssetCollection)
//==============================================================================
/**
 * Entity base class
 * @class
 * @property mc - our MicroCOMPS instance
 * @property id - the entity id
 * @property entityType - the entity type, e.g. "Simulations"
 */
class Entity {
  constructor(mc, id, entityType) {
    this.mc = mc;
    this.id = id;
    this.entityType = entityType;
  }

  //----------------------------------------------------------------------------
  /**
   * Return a human-readable string for this object
   * @returns {string}
   */
  toString() {
    return `[Entity: ${this.entityType}/${this.id}]`;
  }
}

//==============================================================================

//==============================================================================
/**
 * EntityCache - a cache for collected COMPS entity data.
 * @class
 * @property caches - dict<entityType, dict<id, ent>>
 */
class EntityCache {
  //----------------------------------------------------------------------------
  // Constructor
  //----------------------------------------------------------------------------
  constructor() {
    this.clear();
  }

  //----------------------------------------------------------------------------
  /**
   * Get an entry from the cache given an entityType and an id.
   * @param id - the id of the entity you're looking for
   * @returns {object|undefined} - the entity data if found, else undefined
   */
  get(id) {
    if (!id) return undefined;
    if (this.has(id)) {
      for (let key in this.caches) {
        if (id in this.caches[key])
          return this.caches[key][id];
      }
    }
    return undefined;
  }

  //----------------------------------------------------------------------------
  /**
   * Add an entity to the cache. Note that all COMPS entities carry their
   * entityType around with them, so we can obtain it from the entity data.
   * @param {Entity} entity - entity, e.g. sim object - must have an "Id" field
   * @returns {boolean} - true if successful
   */
  add(entity) {
    // Arg checks
    if (!entity) return false;
    let entityType = entity.entityType;

    if (this.has(entity)) {
      // Already in the cache. Not technically an error, but log it since it
      // might be a caller programming error. In this case we'll assign over
      // whatever's there, overlaying entity on the one in the cache
      logWarn(`EntityCache.add: Ignoring attempt to re-add existing ` +
        `sim ${entity.id}`);
      // Layer on whatever they passed in * maybe should just return?
      this.caches[entityType][entity.id] = assign$1(
        this.caches[entityType][entity.id], entity);
    } else {
      // Not in the cache, so add it
      this.caches[entityType][entity.id] = entity;
    }
    return true;
  }

  //----------------------------------------------------------------------------
  /**
   * Remove an entity from the cache.
   * @param entity - The entity you're removing, e.g. a Simulation object
   * @returns {boolean} - true if successful
   */
  remove(entity) {
    if (!entity) return false;
    if (!this.has(entity)) {
      logWarn(`EntityCache.remove: Ignoring attempt to remove non-cached ` +
        `${entity.entityType}/${entity.id}`);
      return false;
    }
    delete this.caches[entity.entityType][entity.id];
    return true;
  }

  //----------------------------------------------------------------------------
  /**
   * Check to see if an entity is in the cache. It can be called either with a
   * string GUID id or an entity object reference.
   * @param {string|Entity} idOrEnt - a string guid id or an Entity
   * use the id argument.
   * @returns {boolean} - true if cached, false if not
   */
  has(idOrEnt) {
    const caches = [    // Search caches in this order
      "Simulations", "Experiments", "AssetCollections", "Suites", "WorkItems" ];
    if (!idOrEnt) return false;
    if (typeof idOrEnt === "string") {
      // id passed in
      for (let key of caches) {
        if (idOrEnt in this.caches[key])
          return true;
      }
    } else if (typeof idOrEnt === "object") {
      // entity reference passed in
      return idOrEnt.id in this.caches[idOrEnt.entityType];
    }
    return false;
  }

  //----------------------------------------------------------------------------
  /**
   * Extend existing entity data with additional data. If the entity isn't in
   * the cache I give the caller a break and add it for them.
   * @param {Entity} entity - the entity to extend
   * @param {object} additionalEntityData - data to layer onto the cached entity
   * @returns {boolean} - true on success
   */
  extend(entity, additionalEntityData) {
    if (!entity || !additionalEntityData) return false;
    entity = assign$1(entity, additionalEntityData);
    let entityType = entity.entityType;
    if (!this.has(entity)) {
      return this.add(entity);
    } else {
      this.caches[entityType][entity.id] = entity;  // Update cache
      return true;
    }
 }

  //----------------------------------------------------------------------------
  /**
   * Clear all entities of all types from the cache.
   */
  clear() {
    this.caches = {
      Simulations: {},
      Experiments: {},
      Suites: {},
      WorkItems: {},
      AssetCollections: {},
    };
  }

  //----------------------------------------------------------------------------
  /**
   * Collect count statistics for all the caches, and a total. Given that the
   * cache rarely has more than a dozen things in it, this is mostly for test.
   * @returns {{AssetCollections: number, Simulations: number, total: number,
   *  WorkItems: number, Experiments: number, Suites: number}} - the counts
   */
  getCounts() {
    let result = {
      total: 0,
      Simulations: 0,
      Experiments: 0,
      Suites: 0,
      WorkItems: 0,
      AssetCollections: 0,
    };
    for (let key of Object.keys(this.caches)) {
      let count = Object.keys(this.caches[key]).length;
      result.total += count;
      result[key] = count;
    }
    return result;
  }

  //----------------------------------------------------------------------------
  /**
   * Return a human-readable string for this object
   * @returns {string}
   */
  toString() {
    let total = 0;
    for (let key of Object.keys(this.caches)) {
      total += Object.keys(this.caches[key]).length;
    }
    let result = `[EntityCache: Total cached: ${total}. Caches:`;
    for (let key of Object.keys(this.caches)) {
      let count = Object.keys(this.caches[key]).length;
      if (count > 0)
        result += ` ${key.substring(0, 3)}s=${count}`;
    }
    result += `]`;
    return result;
  }

}

// COMPS entity types and convenience shortcuts for the lazy library maintainer
const kSimulations = "Simulations";
const kSim = kSimulations;
const kExperiments = "Experiments";
const kExp = kExperiments;
const kSuites = "Suites";
const kSte = kSuites;
const kWorkItems = "WorkItems";
const kWI = kWorkItems;
const kAssetCollections = "AssetCollections";
const kAC = kAssetCollections;

//==============================================================================

/**
 * SpatialBinary - a wrapper for EMOD *SpatialReport*.bin files.
 * @class
 */
class SpatialBinary {

  /**
   * SpatialBinary constuctor.
   * @param {string} [friendlyName] - friendly name in case you've got > 1
   */
  constructor(friendlyName) {
    if (friendlyName === undefined) friendlyName = "None";
    this._realNodeIds = [];     // The ones in the file
    this._nodeIds = [];         // The ones we really use, which c/b overrides
    this._timestepRecs = {};    // C/b indexed like an array _timestepRecs[264]
    this._timestepDomain = [ 0, 0 ];
    this._valueMin = Number.MAX_VALUE;
    this._valueMax = Number.MIN_VALUE;
    this._friendlyName = friendlyName;    // For bookkeeping only

    this._cache = {};   // We cache per-node data after we make it
  }

  //----------------------------------------------------------------------------
  // Accessors
  //----------------------------------------------------------------------------
  getDomain() { return [ this._valueMin, this._valueMax ]; }
  getTimestepDomain() { return this._timestepDomain; }
  getTimestepCount() { return Object.keys(this._timestepRecs).length; }
  getNodeIds() { return this._nodeIds; }

  //----------------------------------------------------------------------------
  getValue(nodeId, timestep) {
    if (this._nodeIds.indexOf(+nodeId) === -1) {
      console.log(`SpatialBinary.getValue(): Invalid nodeId ${nodeId}`);
      return NaN;
    }
    if (this.timestep < this._timestepDomain[0] ||
        this.timestep > this._timestepDomain[1]) {
      console.log(`SpatialBinary.getValue(): Invalid timestep ${nodeId} outside [${this._timestepDomain[0]},${this._timestepDomain[1]}]`);
      return NaN;
    }
    return this._timestepRecs[timestep][nodeId];
  }

  //----------------------------------------------------------------------------
  getSummedValue(timestep) {
    return this._timestepRecs[timestep].reduce((a, v) => a + v, 0);
  }

  //----------------------------------------------------------------------------
  getValueUnchecked(nodeId, timestep) {
    return this._timestepRecs[timestep][nodeId];
  }

  //----------------------------------------------------------------------------
  // All these terrible data-override methods are here so that I can make the
  // antique spatial binary format do what I need. It's in dire need of
  // replacement, but for now I can sorta fix it up.
  // Example: Any v11n that uses spatial binaries is also stuck with integer
  // node ids.
  //----------------------------------------------------------------------------
  /**
   * Provide binary data to this object. It is parsed synchronously.
   * @param binData {ArrayBuffer} - the raw binary data from the wire
   * @param [timestepOffset] {int} - starting timestep if not 0
   * @param [overrideTimestepCount] {int} - truncate output to this if non-zero
   * @param overrideNodeIds {int[]} - to read less than full data
   */
  setData(binData, timestepOffset=0, overrideTimestepCount=0, overrideNodeIds=[])
  {
    let dv = new DataView(binData);
    let nodeCount = dv.getUint32(0, true);
    let timestepCount = dv.getUint32(4, true);  // As read from file
    if (overrideNodeIds.length > 0 && overrideNodeIds.length !== nodeCount)
      return;
    let i, offset = 8;
    for (i = 0; i < nodeCount; i++)
    {
      let readValue = dv.getUint32(offset, true);
      offset += 4;
      const nodeId = overrideNodeIds.length > 0 ? overrideNodeIds[i] : readValue;
      this._nodeIds.push(nodeId);
    }
    this._timestepRecs = {};

    // Read (only) overrideTimestepCount * nodeCount floats
    if (overrideTimestepCount === 0)
      overrideTimestepCount = timestepCount;
    for (i = 0; i < overrideTimestepCount; i++)
    {
      let timestepRec = {};
      let timestep = i + timestepOffset;
      for (let j = 0; j < nodeCount; j++)
      {
        let value = dv.getFloat32(offset, true);
        timestepRec[this._nodeIds[j]] = value;
        offset += 4;
        if (i === 0) {
          this._valueMin = value;
          this._valueMax = value;
        } else {
          if (value > this._valueMax) this._valueMax = value;
          if (value < this._valueMin) this._valueMin = value;
        }
      }
      this._timestepRecs[timestep] = timestepRec;
    }
    this._timestepDomain = [ timestepOffset, timestepOffset + timestepCount - 1 ];
    return this;
  }

  //----------------------------------------------------------------------------
  /**
   * Get an array of floats, one per timestep, for the given nodeId
   * @param {int} nodeId - Must be convertable to int b/c of SpatialBinary fmt
   * @returns {float[]} - Or empty array if nodeId not found.
   */
  getTimeseriesForNode(nodeId) {
    nodeId = +nodeId;
    if (this._nodeIds.indexOf(nodeId) === -1) return [];

    // If it's in the cache, return that
    if (nodeId in this._cache)
      return this._cache[nodeId];

    // Otherwise build it
    let instance = this;
    let result = [];
    const timesteps = Object.keys(this._timestepRecs).map(k => +k);
    timesteps.forEach(timestep => {
      result.push(instance._timestepRecs[timestep][nodeId]);
    });

    // Cache it
    this._cache[nodeId] = result;

    return result;
  }

  //----------------------------------------------------------------------------
  /**
   * Get an array values at this timestep.
   * @param timestep - timestep at which to obtain values
   * @returns {float[]} - array of float values at timestep, one per node
   */
  getValuesAtTimestep(timestep) {
    if (timestep < this._timestepDomain[0] ||
        timestep > this._timestepDomain[1])
      return [];
    return this._timestepRecs[+timestep];
  }

  //----------------------------------------------------------------------------
  /**
   * Get a timeseries where each value is the sum of values across all nodes
   * @returns {float[]} - timeseries where each value is sum across all nodes
   */
  getTimeseriesSumOverNodes() {
    let instance = this;
    const timesteps = Object.keys(this._timestepRecs).map(k => +k);
    return timesteps.map(timestep =>
      // instance._timestepRecs[timestep] is an object keyed on the node ids
      // Lodash reduce on an object iterates every v, k pair in the object.
      // There is no key,value iterator for Object, so using lodash's reduce.
      reduce(instance._timestepRecs[timestep], (a, v, k) => a + v), 0);
  }

  //----------------------------------------------------------------------------
  /**
   * Calculate the [ min, max ] domain of the sum across all nodes x timesteps
   * @returns {number[]} - [ min, max ] across all timesteps and nodes
   */
  getSummedDomain() {
    let ts = this.getTimeseriesSumOverNodes();
    // This reduce emits [ min, max ] of the totals across nodes
    return ts.reduce((a, v) => {
      return a === null ?
        [ v, v ] :
        [ v < a[0] ? v : a[0], v > a[1] ? v : a[1] ];
    }, null);
  }

  //----------------------------------------------------------------------------
  /**
   * Given a local path to a spatial binary, extract a friendly-looking channel
   * name.
   * @example
   * localSpatialPathToChannelName("output/SpatialReport_Daily_EIR.bin")
   * // returns "Daily EIR"
   * @param {string} localPath - the path to prettify
   * @returns {string} - a friendly channel name
   */
  static localSpatialPathToChannelName(localPath) {
    const marker = "SpatialReport_";
    const ext = ".bin";
    const idx = localPath.indexOf(marker);
    let label = idx === -1 ?
      localPath : localPath.substring(idx + marker.length);
    if (label.endsWith(ext))
      label = label.substring(0, label.length - ext.length);
    label = label.replace("_", " ");
    return label;
  }

}

//==============================================================================
// FileRec
//==============================================================================
/**
 * FileRec file record class
 * @property {string} FriendlyName - The user-friendly name of the file/dir
 * @property {string} Id - Unique id for this file/dir object (a GUID)
 * @property {(fileRec[]|null)} Items - Child items, for Type === "Directory"
 *  Null for files.
 * @property {(number|null)} Length - File size in bytes for Type === "File"
 *  Null for directories.
 * @property {string} MimeType - The MIME type for this file, e.g. "text/plain"
 * @property {string} PathFromRoot - The directory part of the path, e.g.
 *  for the file output/InsetCharts.json, PathFromRoot is "output"
 * @property {("File"|"Directory")} Type - Either "File" or "Directory"
 * @property {(string|null)} Url - the COMPS Asset Manager URL to this file
 */
class FileRec {
  /**
   * Constructor - generally not used. These records are normally returned by
   * the comps api or they are conjured from the results of comps api calls that
   * return a different but similar record for files, and that is also the
   * reason for the UpperCamelCase field names here. MicroCOMPS normalizes all
   * files (including output and asset files if present) in the tree with
   * homogenous records like these. File and directory names are case-sensitive.
   */
  constructor() {
    this.FriendlyName = null;       // Display name for file
    this.Id = null;                 // Id of file (used by comps internally)
    this.Items = [/*FileRecs*/];    // Child items, if type is "Directory" or []
    this.Length = 0;                // Length of this file in bytes if File
    this.MimeType = "text/plain";   // MIME type for this file
    this.PathFromRoot = "";         // File's path from the sim root directory
    this.Type = "File";             // File or Directory
    this.Url = "";                  // AM URL for direct access to this file
  }
}

//==============================================================================
// FileTree
//==============================================================================
/**
 * FileTree hold a tree of FileRecs rooted at this.root. It also maintains a
 * reference to MicroCOMPS allowing it to do i/o on the tree's files.
 * @property {MicroCOMPS} mc - reference to MicroCOMPS object
 * @property {[FileRec]} root - the root of the file tree
 * @property {FileRec} rootNode - the root of the file tree, as a FileRec
 */
class FileTree {
  //----------------------------------------------------------------------------
  // Constants
  //----------------------------------------------------------------------------
  static get kWithDirs() { return true; }
  static get kNoDirs() { return false; }

  //----------------------------------------------------------------------------
  // Constructor
  //----------------------------------------------------------------------------
  constructor(mc, root) {
    this.mc = mc;
    this.root = root;
    this.rootNode = this._makeRootNode(root);
    this.listingDirs = null;      // Lazy-created, use getFileList()
    this.listingNoDirs = null;    // Lazy-created, use getFileList()
  }

  //----------------------------------------------------------------------------
  /**
   * Tests for the presence of a local path in the file tree.
   * @param path - file to look for
   * @returns {boolean} - true if the file is present, false if not.
   */
  contains(path) {
    path = this.regularizePath(path);
    const listing = this.getFileList(FileTree.kWithDirs);
    return listing.indexOf(path) !== -1;
  }

  //----------------------------------------------------------------------------
  /**
   * Returns a promise for the bytes of the file at the given local path.
   * @example
   * tree.getFile("output/InsetChart.json")
   *   .then(fileContents => drawCharts(fileContents))
   *   .catch((err) => logError("Failed to get inset chart file.");
   * @example
   * let fileRec = tree.findFileRec("output/InsetChart.json");
   * tree.getFile(fileRec)
   *  .then(fileContents => drawCharts(fileContents))
   *   .catch((err) => logError("Failed to get inset chart file.");
   * @param {string|FileRec} pathOrFileRec - the local path of the file to obtain, like
   *  "output/list.json", OR a FileRec object.
   * @returns {Promise<*>} - promise for the file data
   */
  getFile(pathOrFileRec, responseType="text") {
    let fr = null;
    if (typeof pathOrFileRec === "object" && "Url" in pathOrFileRec)
      fr = pathOrFileRec;
    else {
      if (!pathOrFileRec.startsWith("."))
        pathOrFileRec = "./pathOrFileRec";
      fr = this.findFileRecord(pathOrFileRec);
    }
    if (!fr) {
      return Promise.reject(
        { message: `ERROR: FileTree.getFile: Couldn't find file ${pathOrFileRec}.` }
      );
    }
    return this.mc.request(fr.Url, responseType);
  }

  //----------------------------------------------------------------------------
  /**
   * Returns a single promise for the contents of all the provided local paths.
   * The promise resolves to an array of file contents, ordered in the same
   * order as the input paths. The primary benefit of this function is that it
   * requests all the files in parallel, fails if any fetch fails, and succeeds
   * only after all the files are read.
   * @example
   * let insetData, populationData;
   * tree.getFiles(["output/InsetChart.json", "output/SpatialReport_Population.bin"])
   *   .then(fileContentsArray => {
   *     insetData = fileContentsArray[0];
   *     populationData = fileContentsArray[1];
   *   })
   *   .catch(() => logError("Couldn't fetch files."));
   * @param {[string]} pathArray - an array of local paths (a single string path is ok too)
   * @param {string} responseType - optional - responseType to use for all files
   * @returns {Promise<*>} - promise for an array of all files data
   */
  getFiles(pathArray, responseType="text") {
    if (typeof pathArray === "string")
      pathArray = [pathArray];
    let self = this;
    let mc = this.mc;

    // Make sure we can find the file record for each file
    let frs = pathArray.map(path => self.findFileRecord(path));
    // The above map() will faithfully put nulls in frs on failures
    if (frs.indexOf(null) !== -1) {
      return Promise.reject({ message:
        `ERROR: FileTree.getFiles: One or more files records not found. ` +
        `${JSON.stringify(frs, null, "  ")}`});
    }

    // Sometimes functional programming is pretty
    return Promise.all(frs.map(fr => mc.request(fr.Url, responseType)));
  }

  //----------------------------------------------------------------------------
  /**
   * Attempts to locate the FileRec for a given file by local path. Returns a
   * ref to the FileRec or null. If the given path ends in "/", the function
   * returns the *directory* entry matching path, rather than a file entry.
   * @example
   * let fr = tree.findFileRecord("output/InsetCharts.json")
   * if (fr) {
   *   console.log(`Inset chart url is ${fr.Url});
   * } else logError("Couldn't find file rec.");
   * @param path - local path to the file in question
   * @returns {FileRec|null} - the found file record or null
   */
  findFileRecord(path) {
    let result = null;
    path = this.regularizePath(path);

    // Note whether we're looking for a file or dir record
    const targetIsFolder = (path.endsWith("/"));

    let targetPath = `${path}${targetIsFolder ? "/" : ""}`;
    let self = this;
    this.traverse(fr => {
      let frPath = self.regularizedPathFromFileRec(fr);
      if (frPath === targetPath) {
        result = fr;
        return false;   // Explicit false stops traversal
      } // else keep iterating
    }, targetIsFolder ? FileTree.kWithDirs : FileTree.kNoDirs);
    return result;
  }

  //----------------------------------------------------------------------------
  /**
   * Signature for the lambda used in traverse
   * @callback traverseLambda
   * @param {fileRec} fileOrDirRec - the present file/dir record
   * @param {fileRec[]} coll - the subtree, that is, the array of our siblings.
   * @returns {boolean} - if callback explicitly returns false, iteration is
   * halted. Any other return value is ignored and iteration continues.
   */

  //----------------------------------------------------------------------------
  /**
   * Does a depth-first traversal of the file tree, calling the given lambda on
   * every file (and directory if withDirs is true). This can be used for
   * scanning or listing a sim's files, etc. The withDirs argument determines
   * whether the lambda will be called for FileRecs that have type "Directory."
   * If the flag is false Directory FileRecs are ignored, and the lambda is only
   * called with FileRecs of type "File". The lambda may return false to stop
   * traversal immediately. If the return value is omitted or any other value,
   * traversal continues.
   *
   * NOTE: This function is recursive.
   *
   * The lambda signature is given formally above, but in summary:
   * lambda(fileRec, fileOrDirRec)
   * @example
   * // Count the FileRecs in the tree that represent files without dirs
   * let count = 0;
   * tree.traverse(fr => count++, kNoDirs);
   * @example
   * // This is equivalent to tree.findFileRec("output/InsetChart.json")
   * // because it returns the first matching file by basename
   * // (InsetChart.json), but could find others with the same name.
   * let insetFileRec;
   * tree.traverse((fr, fl) => {
   *    if (fr.FriendlyName === "InsetChart.json") []
   *      insetFileRec = fr;
   *      return false;       // We found what we want, stop iteration
   *      }
   * }, kNoDirs);   * @param lambda - a function to be executed on all FileRecs in the tree
   * @param {traverseLambda} lambda - a function to be executed on all elements
   * @param withDirs - kWithDirs (true) for dir recs too, or kNoDirs
   * @returns void - no return value
   */
  traverse(lambda, withDirs=false) {
    this._traverseImpl(this.root, lambda, withDirs);
  }

  //----------------------------------------------------------------------------
  /** Calculate the number of files and total size of the tree.
   * @returns {[number,number]} - [ fileCount, sizeInBytes ]
   */
  count() {
    let count = 0;
    let size = 0;
    if (!this.root)
      return [0, 0];
    this.traverse(fr => { count++; size += fr.Length; });
    return [count, size];
  }


  //----------------------------------------------------------------------------
  /**
   * Returns a flat file listing of the simulation with paths.
   * @param {boolean} withDirs - whether Directory frs are in the output or not
   * @returns {[string]} - the flattened file list with full paths
   */
  getFileList(withDirs = FileTree.kNoDirs) {
    if (this.listingDirs && this.listingNoDirs)
      return withDirs ? this.listingDirs : this.listingNoDirs;

    // Populate the two listings simultaneously
    let listWithDirs = ["./"];
    let listNoDirs = [];
    let self = this;
    this.traverse(fr => {
      let frPath = self.regularizedPathFromFileRec(fr);
      if (fr.Type === "Directory") frPath += "/";

      // Process directories and files
      if (fr.Type === "Directory") {     // Directory line
        if (withDirs) {
          listWithDirs.push(frPath);
        }
      } else {                           // File line
        listNoDirs.push(frPath);
        listWithDirs.push(frPath);
      }
    }, FileTree.kWithDirs);
    listWithDirs.sort();
    this.listingDirs = listWithDirs;
    this.listingNoDirs = listNoDirs;

    return withDirs ? this.listingDirs : this.listingNoDirs;
  }

  //----------------------------------------------------------------------------
  /**
   * Validate a list of local paths, removing any that are not present in the
   * file tree. This is great for when you have a list of *candidate* files, but
   * they're not always present in every sim.
   * @param localPathArray - list of sim-local paths,
   * @returns {[string]} - only the valid local paths from localPathArray or []
   */
  validateFileList(localPathArray) {
    const listing = this.getFileList(FileTree.kNoDirs);
    let result = [];
    localPathArray.forEach(lp => {
      if (!lp.startsWith("."))   // Make local paths start with ./
        lp = "./" + lp;
      if (lp.endsWith("/"))       // Drop directory-only requests
        return;
      if (listing.indexOf(lp) === -1)   // File not found? Continue
        return;
      result.push(lp);            // Ok we've got this one, transfer to result
    });
    return result;
  }

  //----------------------------------------------------------------------------
  /**
   * Extract a regularized sim-local file path from the given FileRec.
   * @param fileRec - the FileRec for which we want a path
   * @returns {string} - a regularized path, e.g. ./runtime/InsetChart.json
   */
  regularizedPathFromFileRec(fileRec) {
    let frPath = this.regularizePath(
      `${fileRec.PathFromRoot}/${fileRec.FriendlyName}`);
    if (fileRec.Type === "Directory")
      frPath += "/";
    return frPath;
  }

  //----------------------------------------------------------------------------
  /**
   * Regularize a sim-local file path. This means it uses '/' for separators,
   * and starts with './'.
   * @param path - path to regularize
   * @returns {string} - regularized path
   */
  regularizePath(path) {
    path = path.replace("\\" ,"/");
    if (path.startsWith("/"))
      path = path.substring(1);

    // Make all paths start with ./
    if (path === ".")
      path = "./";
    else if (!path.startsWith("."))
      path = "./" + path;

    return path;
  }

  //----------------------------------------------------------------------------
  /**
   * Returns a flat array of file paths for *SpatialReport*.* files in sim.
   * @returns {[string]} - array of SpatialReport file sim-local file paths.
   */
  getSpatialReportList() {
    let keepers = [];
    const list = this.getFileList();
    list.forEach(localPath => {
      if (localPath.indexOf("SpatialReport") !== -1)
        keepers.push(localPath);
    });
    return keepers;
  }

  /**
   * Load all SpatialReport* files into memory. Returns a promise for an object
   * { filePath1: SpatialBinary1, filePath2: SpatialBinary2, ... } where in the
   * keys are the file names and the values are SpatialBinary object initialized
   * on the data. These files can be big, and I unpack them here too, so expect
   * this to take a while.
   * @async
   * @returns {Promise<{}>} - an obj with filename keys and SpatialBinary values
   */
  //----------------------------------------------------------------------------
  getAllSpatialReports() {
    const keepers = this.getSpatialReportList();
    if (keepers.length === 0)
      return Promise.resolve({});
    return this.getFiles(keepers, "arraybuffer")
      .then(fileContentsArray => {
        let result= {};
        keepers.forEach((fn, i) => {
          const sb = new SpatialBinary(fn);
          sb.setData(fileContentsArray[i]);
          result[fn] = sb;
        });
        return Promise.resolve(result);
      });
  }

  //----------------------------------------------------------------------------
  /**
   * Return a human-readable string for this object
   * @returns {string} - a simple text rep of the file tree object
   */
  toString() {
    const stats = this.count();
    return `[FileTree: ${this.root ?
      `${stats[0].toLocaleString()} files, ${stats[1].toLocaleString()} bytes` :
      "not present" }]`;
  }

  //----------------------------------------------------------------------------
  // Implementation
  //----------------------------------------------------------------------------
  /**
   * Recursive implementation for findFileRecord.
   * @param files - list of files at the current directory level
   * @param path - the path we're looking for
   * @returns {false|void} - false when found, no return otherwise
   * @private
   */
  _findFileRecordImpl(files, path) {
    let self = this;

    // Is the caller looking for a file or a directory?
    let targetIsDir = path.endsWith("/");
    if (targetIsDir) {
      // We're processing a file
      return files.find(rec =>
        (rec.Type === "File" || rec.Type === "SymLinkFile") &&
        path === self.regularizedPathFromFileRec(rec));
    } else {
      // We're processing a directory
      let frPath = self.regularizedPathFromFileRec(files);
      if (path === frPath)
        return false;
      else return self._findFileRecordImpl(files.Items, path);
    }
  }

  //----------------------------------------------------------------------------
  /**
   * Recursive innards of traverse. Used internally.
   * @param files - the current file list
   * @param lambda - the function to be applied to each file record
   * @param withDirs - flags whether dir file recs are considered
   * @returns void - no return value
   * @private
   */
  _traverseImpl(files, lambda, withDirs=false) {
    let self = this;
    let bugout = false;
    // First find and run the lambda on all the files in this directory
    const pofs = files.filter(rec =>
      rec.Type === "File" || rec.Type === "SymLinkFile");
    forEach(pofs, (pof, index, coll) => {
      if (lambda(pof, coll) === false) {
        bugout = true;
        return false;   // Makes _ exit immediately
      }
      //else...I don't care about any other value
    });
    if (bugout) return; // Lambda says we're done

    // Now find and run the lambda on all the directories in this directory
    const dirs = files.filter(rec =>
      rec.Type === "SymLinkDirectory" || rec.Type === "Directory");
    forEach(dirs, (dir, index, coll) => {
      // If the "withDirs" flag is set, call the lambda on the dirs too
      if (withDirs) {
        if (lambda(dir, coll) === false) {
          return false;   // Makes _ exit immediately
        }
      }
      // Recurse on it
      self._traverseImpl(dir.Items, lambda, withDirs);
    });
  }

  //----------------------------------------------------------------------------
  /**
   * Create a synthetic FileRec to wrap the root FileRec array. This makes
   * interop with things like @mui/labs <TreeView/> easier. See the React demo.
   * @param items - the root FileRec array
   * @returns {FileRec} - A synthetic FileRec with its Items set to items
   * @private
   */
  _makeRootNode(items) {
    return {
      Id: "/",
      Type: "Directory",
      Items: items,
      FriendlyName: "/",
      PathFromRoot: "",
      Length: null,
      MimeType: "none/none",
      Url: "",
    };
  }

} // class FileTree

/*! js-cookie v3.0.1 | MIT */
/* eslint-disable no-var */
function assign (target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i];
    for (var key in source) {
      target[key] = source[key];
    }
  }
  return target
}
/* eslint-enable no-var */

/* eslint-disable no-var */
var defaultConverter = {
  read: function (value) {
    if (value[0] === '"') {
      value = value.slice(1, -1);
    }
    return value.replace(/(%[\dA-F]{2})+/gi, decodeURIComponent)
  },
  write: function (value) {
    return encodeURIComponent(value).replace(
      /%(2[346BF]|3[AC-F]|40|5[BDE]|60|7[BCD])/g,
      decodeURIComponent
    )
  }
};
/* eslint-enable no-var */

/* eslint-disable no-var */

function init (converter, defaultAttributes) {
  function set (key, value, attributes) {
    if (typeof document === 'undefined') {
      return
    }

    attributes = assign({}, defaultAttributes, attributes);

    if (typeof attributes.expires === 'number') {
      attributes.expires = new Date(Date.now() + attributes.expires * 864e5);
    }
    if (attributes.expires) {
      attributes.expires = attributes.expires.toUTCString();
    }

    key = encodeURIComponent(key)
      .replace(/%(2[346B]|5E|60|7C)/g, decodeURIComponent)
      .replace(/[()]/g, escape);

    var stringifiedAttributes = '';
    for (var attributeName in attributes) {
      if (!attributes[attributeName]) {
        continue
      }

      stringifiedAttributes += '; ' + attributeName;

      if (attributes[attributeName] === true) {
        continue
      }

      // Considers RFC 6265 section 5.2:
      // ...
      // 3.  If the remaining unparsed-attributes contains a %x3B (";")
      //     character:
      // Consume the characters of the unparsed-attributes up to,
      // not including, the first %x3B (";") character.
      // ...
      stringifiedAttributes += '=' + attributes[attributeName].split(';')[0];
    }

    return (document.cookie =
      key + '=' + converter.write(value, key) + stringifiedAttributes)
  }

  function get (key) {
    if (typeof document === 'undefined' || (arguments.length && !key)) {
      return
    }

    // To prevent the for loop in the first place assign an empty array
    // in case there are no cookies at all.
    var cookies = document.cookie ? document.cookie.split('; ') : [];
    var jar = {};
    for (var i = 0; i < cookies.length; i++) {
      var parts = cookies[i].split('=');
      var value = parts.slice(1).join('=');

      try {
        var foundKey = decodeURIComponent(parts[0]);
        jar[foundKey] = converter.read(value, foundKey);

        if (key === foundKey) {
          break
        }
      } catch (e) {}
    }

    return key ? jar[key] : jar
  }

  return Object.create(
    {
      set: set,
      get: get,
      remove: function (key, attributes) {
        set(
          key,
          '',
          assign({}, attributes, {
            expires: -1
          })
        );
      },
      withAttributes: function (attributes) {
        return init(this.converter, assign({}, this.attributes, attributes))
      },
      withConverter: function (converter) {
        return init(assign({}, this.converter, converter), this.attributes)
      }
    },
    {
      attributes: { value: Object.freeze(defaultAttributes) },
      converter: { value: Object.freeze(converter) }
    }
  )
}

var api = init(defaultConverter, { path: '/' });

// Soon this file will probably get broken down into multiple topical files.

// Utility categories. Use these to search for the section heading
// Strings
// Arrays
// Objects
// Events
// Cookies
// DOM+WebComponents
// Colors
// Paths
// Network
// Inset
// Geospatial

//==============================================================================
// Strings
//==============================================================================
/**
 * Converts a string to title case, e.g. "read the docs" => "Read The Docs".
 * q.v. [Stack Overflow]{@link https://stackoverflow.com/a/196991}
 * @param {string} str - the string to titleCase
 * @returns {string} - the titlecased string
 */
function toTitleCase(str) {
  return str.replace(/\b\w+/g, txt =>
    txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase());
}

//------------------------------------------------------------------------------
/**
 * Convert a COMPS token to a string optimized for human readability.
 * @param {string} token - the COMPS token you want to display
 * @returns {string} - a prettified string for the token
 */
function tokenToString(token) {
  let parts = token.split(",");
  if (parts.length < 6) return "[unparsable token]";
  return `COMPS token for ${parts[2]}@${parts[5]}, good until ${parts[6]}`
}

//------------------------------------------------------------------------------
/**
 * Generate a new GUID. Borrowed verbatim from COMPS.
 * @returns {string} - guid in 36-character string format
 */
function generateGuid() {
  let now = Date.now();
  // stackoverflow.com/questions/105034/create-guid-uuid-in-javascript
  let guid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    let r = (now + Math.random() * 16) % 16 | 0;
    now = Math.floor(now / 16);
    let modR = (r & 0x3) | 0x8; // Unnecessary parens added for eslint
    return (c === "x" ? r : modR).toString(16);
  });
  return guid;
}

//------------------------------------------------------------------------------
/**
 * Check the validity of a given GUID. Just checks for syntactic validity, not
 * whether the guid represents any COMPS entity.
 * @param val - the potential GUID to be checked, tolerant of null/undef
 * @returns {boolean} - true if a valid-looking guid, false if not
 */
function isValidGuid(val) {
  if (!val || typeof val !== "string" || val.length === 0) return false;
  let guid = val.trim();
  if (guid.length !== 36)
    return false;
  let pat = /^(((?=.*}$){)|((?!.*}$)))((?!.*-.*)|(?=(.*[-].*){4}))[0-9a-fA-F]{8}[-]?([0-9a-fA-F]{4}[-]?){3}[0-9a-fA-F]{12}?[}]?$/;
  return guid.match(pat) !== null;
}

//------------------------------------------------------------------------------
/**
 * Generate a human-readable version of a COMPS token for debugging/logging.
 * @param {string} token - optional token obtained from the COMPS auth-lib
 * @returns {string|*} - a string like "[user@xx.xx.xx.xx for apps until date]"
 */
function humanizeToken(token) {
  if (!token) return "[No token]";
  let parsed;
  try {
    parsed = token.split(",");
    // [0]: "1"
    // [1]: "Ḁuth"
    // [2]: "bressler"
    // [3]: "10.24.14.11"
    // [4]: "p-5wwHRZLd7niPlE9NLYMUyiX2VrCzvjgwC4O-Zm_I8."
    // [5]: "IDMSPAPP01"
    // [6]: "2022-09-21-23-08-55"
    // [7]: "2022-09-21-19-08-55"
    // [8]: "...base64..."
    let exp = parsed[6];
    if (exp) {
      let m = exp.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/);
      if (m) {
        exp = new Date(
          Date.parse(`${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`))
          .toLocaleString();
      }
      return `[${parsed[2]}@${parsed[5]} until ${exp}]`;
    } else return "[Token details unknown]"
  }
  catch(err) {
    logError$1("Utils.humanizeToken: unparseable token");
    console.log(err);
  }
  return "[Token details unknown]";  // Can happen if a fake token comes in
}

//------------------------------------------------------------------------------
/**
 * Clean up an COMPS-Auth-style baseurl into the format we want
 * (without the /api/ suffix.)
 * @param url {string} url - url to clean
 * @returns {string} - cleaned url
 */
function cleanBaseUrl(url) {
  if (url.endsWith("/"))
    url = url.substring(0, url.length - 1);
  if (url.endsWith("/api"))
    url = url.substring(0, url.length - 4);
  return url;
}

//==============================================================================
// Arrays
//==============================================================================
/**
 * Emit a new array with newEntry appended iff newEntry is not already in the
 * array. Tne compare function compares newEntry for equality. If compare is
 * now passed in, the shallowCompare function is used.
 * NOTE: This function is deliberately inefficient - it returns a copy of arr
 * with the new entry appended. This is because in React you need to replace
 * objects in state to trigger effects.
 * @param {[object]} arr - the initial array
 * @param {object} newEntry - the object to be appended
 * @param {function} compare [optional}
 * @returns {*|*[]} - a new array with newEntry appended or arr if already there
 */
function appendIfUnique(arr, newEntry, compare=shallowCompare) {
  const found = arr.find(entry => compare(entry, newEntry));
  return found ? arr : [ ...arr, newEntry ];
}

//==============================================================================
// Objects
//==============================================================================
/**
 * Shallow-compare two objects for equality. To be equal, two objects must:
 *   1. Have the same number of keys
 *   2. Have the same keys
 *   3. Have the same types for the values of each key
 *   4. Have equivalent values (with ===) for each key
 * There are cases that will not be detected by this simple algorithm, but it
 * is good enough for most cases. (E.g. -0 and 0 are treated as equivalent.)
 * @param o1 - first object to compare
 * @param o2 - second object to compare
 * @returns {boolean} - true if o1 and o1 are equal on shallow comparison
 */
function shallowCompare(o1, o2) {
  const o1Keys = Object.keys(o1);
  const o2Keys = Object.keys(o2);
  if (o1Keys.length !== o2Keys.length)
    return false;
  for (const propName of o1Keys) {
    if (!o2.hasOwnProperty(propName))
      return false;
    if (typeof o1[propName] !== typeof o2[propName])
      return false;
    if (o1[propName] !== o2[propName])
      return false;
  }
  return true;
}

//------------------------------------------------------------------------------
/**
 * Given an object, recursively builds a linear list of fully-qualified key
 * names and values in an object. That is to say, the output object is unnested.
 * IMPORTANT: This function specifically copies array values as-is, rather than
 * splay them out, and this is a minor optimization that reduces the size of the
 * output flattened obj for our most common use cases.
 * @example
 * flattenedObject({ a: [ 42, 28 ] })
 *  =>    // ACTUALLY returns
 *  {
 *    a: [42, 28],
 *  }
 *
 *  => {  // DOES NOT return
 *    a.1 = 42
 *    a.2 = 28
 *  }
 * @note This function is recursive.
 * @param {object} obj - the (possibly complicated) target object
 * @returns {object} - the flattened key/value list
 */
function flattenObject(obj) {
  let result = {};

  for (let objKey in obj) {
    if (!obj.hasOwnProperty(objKey))
      continue;

    let valType = typeof obj[objKey];
    if (isArray(obj[objKey])) {
      result[objKey] = obj[objKey];
    } else if (valType === 'object' && obj[objKey] !== null) {
      let flatObject = flattenObject(obj[objKey]);
      for (let flatObjectKey in flatObject) {
        if (!flatObject.hasOwnProperty(flatObjectKey))
          continue;
        result[objKey + '.' + flatObjectKey] = flatObject[flatObjectKey];
      }
    } else {
      result[objKey] = obj[objKey];
    }
  }
  return result;
}

//------------------------------------------------------------------------------
/**
 * Overlay one object's properties with extra. Does not *replace* keys, just
 * adds new or modifies existing keys in the destination.
 * Test object for your amusement:
 * x = { a: { a1: 1, a2: "2", a3: null }, b: 42, c: { c4: 4, c5: "5", c6: { c67: 67, c68: "68", c69: [ 6, 7, 8, 9 ] } }, d: "howdy", e: [ 42, 28 ], f: null }
 * @param {object} obj - the destination object getting overlaid
 * @param {object} extra - the extra stuff to layer on
 * @returns {object}
 */
function overlayObject(obj, extra) {
  let flattened = flattenObject(extra);
  for (let flatKey in flattened) {
    set(obj, flatKey, flattened[flatKey]);
  }
  return obj;
}

//------------------------------------------------------------------------------
/**
 * Overlay an array of sources onto dest. See overlayObject for details.
 * @param dest - The object accepting updated properties
 * @param sourceArray - An array of object with replacement properties
 * @returns {[object]} - dest with all of sourceArray overlaid on it
 */
function overlayObjects(dest, sourceArray) {
  sourceArray.map(source => overlayObject(dest, source));
  return dest;
}

//==============================================================================
// Events
//==============================================================================
/**
 * Stop propagation and prevent default on an event.
 * @param {Event} evt - the event to halt
 * @returns void
 */
function stopEvent(evt) {
  if (typeof evt !== "object" || evt === null || evt === undefined) return;
  if ("stopPropagation" in evt)
    evt.stopPropagation();
  if ("preventDefault" in evt)
    evt.preventDefault();
}

//==============================================================================
// Cookie
// These functions are thin veneer on js-cookie, but these functions add a bit
// of value with encode/decode and lambda.
//==============================================================================
/**
 * A simple chimney to Cookies library, but adds useful default arg.
 * @param {string} keyName - the name of the cookie key, e.g. "
 * @param {*} dflt - a default value in case keyName is not found
 * @param {boolean} decode - true to decodeURIComponent. default: false
 * @returns {*} - the cookie value or the default
 * @example
 * // This attempts to get the COMPS theme from the cookie, and defaults to "light"
 * // if the key is not found.
 * let theme = getCookie("explore.contentExhibit.theme", "light");
 */
function getCookie(keyName, dflt, decode=false) {
  let result = api.get(keyName);
  if (result === undefined)
    result = dflt;
  else if (decode)
    result = decodeURIComponent(result);
  return result;
}

//------------------------------------------------------------------------------
/**
 * Set a cookie key/value pair. Chimney to Cookies library, but adds a default
 * one-year expiration if not provided.
 * @param {string} keyName - the cookie key name to use
 * @param {string} value - the value, will be converted to string
 * @param {number} exDays - the lifetime of the cookie in days. Default: 365
 * @param {boolean} encode - true to run encodeURIComponent. default: false
 * @returns void
 */
function setCookie(keyName, value, exDays=365, encode=false) {
  if (typeof exDays === "boolean") {
    // Caller left out the exDays arg
    encode = exDays;
    exDays = 365;
  }
  if (encode)
    api.set(keyName, encodeURIComponent(value), { expires: exDays });
  else api.set(keyName, value, { expires: exDays });
}

//------------------------------------------------------------------------------
/**
 * Run a lambda expression on each cookie key-value pair.
 * Lambda signature: void fn(key, value, collection);
 * @param {function} lambda - the function to run on each cookie entry.
 * @returns void
 */
function forEachCookie(lambda) {
  let entries = api.get();
  Object.keys(entries).forEach(key => lambda(key, entries[key], entries));
}

//------------------------------------------------------------------------------
/**
 * Delete the cookie entry with the given name from the cookie.
 * @param keyName - cookie key name to delete
 */
function deleteCookie(keyName) {
  api.remove(keyName);
}

//==============================================================================
// DOM+WebComponents
//==============================================================================
/**
 * This boilerplate function registers a custom element w/o *re*-registering.
 * @param {string} tagName - the new tag name you're registering, e.g "box-plot"
 * @param {Class} handlerClass - the class that implements the web component
 * @returns void
 */
function customElementsDefineSafe(tagName, handlerClass) {
  if (!customElements.get(tagName))
    customElements.define(tagName, handlerClass);
  // else already registered
}

//------------------------------------------------------------------------------
/**
 * Robustly escape a string for display in HTML.
 * @example
 *   cleanForHtml("<em>Love</em> & Hope") =>
 *     "&lt;em&gt;log(string)&lt;/em&gt; &amp; Hope"
 * @param {string} str - the string that needs escaping
 * @returns {string} - the escaped string, kindly escaped by the browser
 * @see cleanTags
 */
function cleanForHtml(str) {
  return new Option(str).innerHTML;   // Cool trick to escape stuff for HTML
}

//------------------------------------------------------------------------------
/**
 * Robustly remove <tags> from string. Does NOT escape the string.
 * @example
 *   cleanTags("<em>Love</em> & Hope") =>
 *     "Love & Hope"   // Note the '&', you still need to escape
 * @param {string} str - the string that needs tags removed
 * @returns {string} - the cleaned string, kindly cleaned by the browser
 * @see cleanForHtml
 */
function cleanTags(str) {
  const div = document.createElement("div");
  div.innerHTML = str;
  return div.textContent || div.innerText || "";
}

//------------------------------------------------------------------------------
/**
 * Determines whether the present page is running in an <iframe>.
 * @returns {boolean} - true if in iframe, false if not.
 * @see {@link https://stackoverflow.com/a/326076}
 */
function inIFrame() {
  try {
    if (typeof window !== "undefined")
    return window.self !== window.top;
    else return false;
  } catch (e) {
    return false;
  }
}

//------------------------------------------------------------------------------
/** Belongs in a graphics section * IMPROVE
 * Returns whether point (ptX, ptY) is within the rect [left, top, wid, ht].
 * @param {number} ptX - x coordinate to test
 * @param {number} ptY - y coordinate to test
 * @param {number[]} ltwh - rectangle specified as [ left, top, width, height ]
 * @returns {boolean} - whether the point is in the rect
 */
function pointInRect(ptX, ptY, ltwh) {
  return (
    ptX >= ltwh[0] &&
    ptX < ltwh[0] + ltwh[2] &&
    ptY >= ltwh[1] &&
    ptY < ltwh[1] + ltwh[3]
  );
}

//------------------------------------------------------------------------------
/**
 * Focus the given (presumed text-) element and select all its text.
 * @param textInputElement - the element to focus
 */
function focusAndSelectAll(textInputElement) {
  textInputElement.focus();
  textInputElement.setSelectionRange(0, textInputElement.value.length);
}

//------------------------------------------------------------------------------
/**
 * Use the browser to parse HTML text and return the resultant document fragment
 * @param html - the HTML text to parse
 * @returns {DocumentFragment} - the doc fragment, suitable for insertion
 * @ref - https://gist.github.com/ryanmorr/58495cf47fc783bac8c8783c9e517e0b
 */
function parseHTML(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

//------------------------------------------------------------------------------
/**
 * Get the value of a CSS variable from JavaScript. Note that if you're a web
 * component, you can generally use "this" for the element argument.
 * @param {Element} element - element that can see dashDashVarName
 * @param {string} dashDashVarName - var name, e.g. '--bg-color'
 * @param {any} [dflt] - default to return in case var value can't be obtained
 * @returns {string|undefined} - variable value or undefined
 */
function getCssVariable(element, dashDashVarName, dflt=undefined) {
  const compStyle = getComputedStyle(element);
  if (compStyle)
    return compStyle.getPropertyValue(dashDashVarName);
  else return dflt;
}

//==============================================================================
// Colors
//==============================================================================
/**
 * Parse a color string into a structure like { a: [0, 255], r:, g:, b: }. This
 * is NOT a full CSS color-string parser, i.e. no support for "rgba(...)" etc.
 * @param {string} str - the color string to convert. This string may be in the
 * following formats:
 * @example
 * hashToColor("#d40000") => { a: 255, r: 212, g: 0, b: 0 }
 * hashToColor("d40000") => { a: 255, r: 212, g: 0, b: 0 }
 * hashToColor("#88ff2000") => { a: 128, r: 255, g: 32, b: 0 }
 * hashToColor("88ff2000") => { a: 128, r: 255, g: 32, b: 0 }
 * @returns {{a: number, r: number, b: number, g: number}} - color components in
 * the range [0, 255] for all values. If alpha was not present in the input
 * string, the output alpha will be 255.
 */
//
function hashToColorObj(str) {
  if (isString(str) && str.length > 0) {
    if (str[0] === "#") str = str.substring(1);
    if (str.length === 6)
      return {
        a: 255,
        r: parseInt(str.substring(0,2), 16),
        g: parseInt(str.substring(2,4), 16),
        b: parseInt(str.substring(4,6), 16),
      };
    else return {
      a: parseInt(str.substring(0,2), 16),
      r: parseInt(str.substring(2,4), 16),
      g: parseInt(str.substring(4,6), 16),
      b: parseInt(str.substring(6,8), 16),
    }
  }
  return { a: 255, r: 0, g: 0, b: 0 }
}

//------------------------------------------------------------------------------
/**
 * Given a color object from [hashToColorObj]{@link hashToColorObj} above,
 * convert to a hash string.
 * @param {{a: number, r: number, b: number, g: number}} colorObj - the color
 * object to convert
 * @param {boolean} withAlpha - whether to include the alpha value in the hash
 * @returns {string} - the hash, either "#rrggbb" or "#aarrggbb"
 */
function colorObjToHash(colorObj, withAlpha=false) {
  if (withAlpha) {
    return `#${("0" + colorObj.a.toString(16)).substring(0,2)}${("0" + colorObj.r.toString(16)).substring(0,2)}${("0" + colorObj.g.toString(16)).substring(0,2)}${("0" + colorObj.b.toString(16)).substring(0,2)}`
  } else {
    return `#${("0" + colorObj.r.toString(16)).substring(0,2)}${("0" + colorObj.g.toString(16)).substring(0,2)}${("0" + colorObj.b.toString(16)).substring(0,2)}`
  }
}

//------------------------------------------------------------------------------
// Adapted from jQuery.Color
//------------------------------------------------------------------------------
/**
 * Given a color object from [hashToColorObj]{@link hashToColorObj} above
 * return the same color object with additional {s:, h:, and l:} values.
 * Preserves r, g, b, and a.
 * @param {{a: number, r: number, b: number, g: number}} c - the color
 * object to convert
 * @returns {{a: number, r: number, b: number, g: number, h: number, s: number, l: number}} -
 * the same color, but with additional hue [0, 360), sat [0, 1], and l [0,1].
 */
function rgbToHsl(c) {
  let r = c.r / 255;
  let g = c.g / 255;
  let b = c.b / 255;
  let a = c.a;
  let max = Math.max(r, g, b);
  let min = Math.min(r, g, b);
  let diff = max - min;
  let add = max + min;
  let l = add * 0.5;
  let h, s;

  if (min === max) {
    h = 0;
  } else if (r === max) {
    h = (60.0 * (g - b) / diff) + 360.0;
  } else if (g === max) {
    h = (60.0 * (b - r) / diff) + 120.0;
  } else {
    h = (60.0 * (r - g) / diff) + 240.0;
  }

  // chroma (diff) == 0 means grayscale which, by definition, saturation = 0%
  // otherwise, saturation is based on the ratio of chroma (diff) to lightness (add)
  if (diff === 0) {
    s = 0;
  } else if (l <= 0.5) {
    s = diff / add;
  } else {
    s = diff / (2.0 - add);
  }
  return { a: a, h: h % 360.0, s: s, l: l };
}

//------------------------------------------------------------------------------
/**
 * Convert a color object (already containing h, s, and v members) to also have
 * r, g, and b, values in the range [0, 255]. Preserves h, s, v and a.
 * @param {{a: number, h: number, s: number, l: number}} colorObj - the color to
 * be converted
 * @returns {{a: number, r: number, b: number, g: number, h: number, s: number, l: number}} -
 * the same color, but with additional hue [0, 360), sat [0, 1], and l [0,1].
 */
function hslToRgb(hc) {
  let h = hc.h / 360.0,
    s = hc.s,
    l = hc.v,
    a = hc.a,
    q = l <= 0.5 ? l * (1.0 + s) : l + s - l * s,
    p = 2.0 * l - q;

  function hueToRgb(p, q, h) {
    h = (h + 1.0) % 1.0;
    if (h * 6.0 < 1) {
      return p + (q - p) * h * 6.0;
    }
    if (h * 2 < 1.0) {
      return q;
    }
    if (h * 3.0 < 2.0) {
      return p + (q - p) * ((.02 / 3.0) - h) * 6.0;
    }
    return p;
  }

  return merge(hc, {
    r: Math.round(hueToRgb(p, q, h + (1.0 / 3.0)) * 255),
    g: Math.round(hueToRgb(p, q, h) * 255),
    b: Math.round(hueToRgb(p, q, h - (1.0 / 3.0)) * 255),
    a: a,
  });
}

//------------------------------------------------------------------------------
/**
 * Clamp a number to the [0, 255] range
 * @param {number} val - the value to clamp
 * @returns {number} - the clamped value
 */
function byteClamp(val) {
  if (val < 0) return 0;
  if (val > 255) return 255;
  return val;
}

//------------------------------------------------------------------------------
// NOTE: max is INCLUSIVE.
//------------------------------------------------------------------------------
/**
 * Clamp a value to the interval [minIncl, maxIncl], i.e. can return maxIncl
 * @param {number} val - the value to clamp * @param {number} minIncl
 * @param {number} minIncl - the minimum value of the range, inclusive
 * @param {number} maxIncl - the maximum value of the range, INCLUSIVE
 * @returns {number} - the clamped value
 */
function clampIncl(val, minIncl, maxIncl) {
  if (val < minIncl) return minIncl;
  if (val >= maxIncl) return maxIncl;
  return val;
}

//------------------------------------------------------------------------------
/**
 * Clamp a value to the interval [minIncl, maxExcl), i.e. never returns max
 * @param {number} val - the value to clamp * @param {number} minIncl
 * @param {number} minIncl - the minimum value of the range, inclusive
 * @param {number} maxExcl - the maximum value of the range, EXCLUSIVE
 * @returns {number} - the clamped value
 */
function clamp(val, minIncl, maxExcl) {
  return (val < minIncl) ? minIncl :
    (val >= maxExcl) ? maxExcl - Number.EPSILON : val;
}

//------------------------------------------------------------------------------
/**
 * Clamp a value to the interval [0, 1), i.e. never returns 1
 * @param {number} val - the value to clamp
 * @returns {number} - the clamped value
 */
function clampNormIncl(val) {
  return clamp(val, 0, 1);
}

//------------------------------------------------------------------------------
// colors argument and return value: [ "#rrggbb" [, "##rrggbb] [, ...] ]
// lambda argument: function(colorObj, index, colorArray), where
//    colorObjs is a color object { a, r, g, b } for easier processing
//    index is the index into colors
//    colorArray is colors
//    return: colorObj    <--- NOT a "#rrggbb" string. adjustColors will do that
//
// Example:
//    adjustColors(colors, c => {
//      a: c.a,
//      r: byteclamp(c.r * 2),
//      g: byteclamp(c.g * 2),
//      b: byteclamp(c.b * 2)
//    });
//------------------------------------------------------------------------------
/**
 * Run a lambda over an array of colors, wherein the function may modify the
 * colors. Returns a new array. Handy for doing some common operation on colors,
 * like making them all darker or whatever.
 * @param {string[]} colors - array of hash-colors, like [ "#rrggbb", ... ]
 * @param lambda
 * @returns {*}
 */
function adjustColors(colors, lambda) {
  return colors.map((c, i, a) => {
    let rgb = hashToColorObj(c);
    rgb = lambda(rgb, i, a);
    let str = colorObjToHash(rgb);
    return str;
  });
}

//------------------------------------------------------------------------------
/**
 * Calculate the normalized luminance of the given color.
 * @param {string} color - hash color string as parsed by
 * {@link hashToColorObj} target color
 * @returns {number} - normalized luminance [0,1]
 * @example
 * // The usual reason to call this function is to decide whether to use black or
 * // white text/foreground against a given background color. So here you go. The
 * // threshold is empirical.
 * function contrastColor(colorHash) {
 *   return luminance(colorHash) < 0.4 ? "#ffffff" : "#000000";
 * }
 @example
 * // Relatedly, if you've got the lightness from HSL, you can use a different
 * // threshold for that. The threshold is empirical.
 * function contrastColorLightness(hslLightness) {
 *   return hslLightness < 0.55 ? "#ffffff" : "#000000";
 * }
 */
function luminance(color) {
  let c = hashToColorObj(color);
  return 0.2126 * (c.r / 255.0) + 0.7152 * (c.g / 255.0) + 0.0722 * (c.b / 255.0);
}

//------------------------------------------------------------------------------
/**
 * Calculate contrast between two colors. (Technically doesn't matter which is
 * foreground and which is background, it's lighter / darker.)
 *
 * Interpretation:
 *  * 1.0 = NO CONTRAST (i.e. bkgd === fore)
 * @param {string} bkgd  - hash color background
 * @param {string} fore - hash color foreground
 * @returns {number} - contrast ratio between background and foreground
 */
function contrastRatio(bkgd, fore) {
  const bkgdLum = luminance(bkgd);
  const foreLum = luminance(fore);
  return (Math.min(bkgdLum, foreLum) + 0.05) / (Math.max(bkgdLum, foreLum) + 0.05);
}

//==============================================================================
// Paths
//==============================================================================
/**
 * Return everything to the right of the first '/'.
 * @example
 * basename("output/InsetCharts.json")  // makes "InsetCharts.json"
 * @example
 * basename("http://localhost:8888/image/favicon.ico")  // makes "favicon.ico"
 * @param path
 * @returns {*|string}
 */
function basename(path) {
  const slashIndex = path.lastIndexOf('/');
  return slashIndex === -1 ? path : path.substring(slashIndex + 1);
}

//------------------------------------------------------------------------------
/**
 * Return everything to the left of the first '.'.
 * @example
 * stripExtension("output/InsetCharts.json")  // makes "output/InsetCharts"
 * @example
 * stripExtension("http://localhost:8888/api") // makes "http://localhost:8888/api"
 * @example
 * stripExtension(baseName("output/InsetCharts.json")) // makes "InsetCharts"
 * @param path
 * @returns {*|string}
 */
function stripExtension(path) {
  const dotIndex = path.lastIndexOf('.');
  return dotIndex === -1 ? path : path.substring(0, dotIndex);
}

//==============================================================================
// Network
//==============================================================================
/**
 * Compares the given host (usually taken from window.location.host[name])
 * against known aliases for localhost and returns true if it matches any.
 * @param host - the hostname to test. Presence of port, etc. won't break it
 * @returns {boolean} - true if host looks like localhost, false if not
 */
function isLocalhost(host) {
  for (let selfHostname of kLocalhostAliases)
    if (host.toLowerCase().indexOf(selfHostname) !== -1)
      return true;
  return false;
}

//==============================================================================
// Inset
//==============================================================================
/**
 * Inset chart Channel record
 * @typedef {Object} Channel
 * @property {string} Units - The channel's units
 * @property {[any]} Data - The channel's data (which could be more arrays)
 */

//----------------------------------------------------------------------------
/**
 * Signature for the lambda used in filterInsetChannels
 * @callback filterInsetChannelsLambda
 * @param {string} channelName - the present channel's name (key)
 * @param {Channel} channel - the present Channel's data structure
 * @returns {boolean} - true if the channel is to be kept, false to drop
 */

//----------------------------------------------------------------------------
/**
 * Run a lambda function over the channels of inset-chart-shaped data and only
 * keep the channels for which the lambda returns a truthy result. The signature
 * of the lambda is bool lambda(channelName:str, channel:Channel). The lambda
 * should return true for any channel to keep, or false for channels to drop.
 * @example
 * // This example drops all channels that start with "Population"
 * filterInsetChannels(myRawInsetData, (chName, ch) => {
 *   return !chName.startsWith("Population");
 * });
 * @param rawInsetData - the inset data to modify in-place
 * @param {filterInsetChannelsLambda} lambda - a lambda function to run on each
 * channelName/channel combo
 */
function filterInsetChannels(rawInsetData, lambda) {
  rawInsetData.Channels =
    Object.keys(rawInsetData.Channels).reduce((a, chName) => {
      const ch = rawInsetData.Channels[chName];
      if (lambda(chName, ch))
        a[chName] = ch;
      return a;
    }, {});
}

//==============================================================================
// Geospatial
//==============================================================================

//==============================================================================
// Simulation
//
// Simulation inherits from Entity:
// Data member    Description
// -------------- -----------------------------------------------------------
//   mc           our reference to MicroCOMPS
//   id           the entity ID
//   entityType   the entity type (e.g. "Simulations", a COMPS entity type)
//
// Simulation maintains:
// Data member    Description
// -------------- -----------------------------------------------------------
//   info         accumulated simulation info (or null)
//   job          the succeeding job, if any (or null)
//   tree         the FileTree with all files from succeeding job, or just
//                input and asset files if no succeeding job.
//   config       the simulation's config (or null)
//   demographics the simulation's pre-overlaid demographics (or null)
//==============================================================================
/**
 * Simulation Entity class
 * @class
 * @property {object|null} info - the simulation info object return by COMPS
 * @property {object|null} job - the succeeding job, or null if none
 * @property {FileTree|null} tree - the FileTree object with the sim's file
 */
class Simulation extends Entity {
  static get kDefaultConfigFilename() { return "./config.json" }
  static get kDemographicsDir() { return "./Assets" }

  //----------------------------------------------------------------------------
  // Constructor
  //----------------------------------------------------------------------------
  /**
   * Construct a Simulation object. The Simulation is not put into the entity
   * cache until populate().
   * @param mc - the MicroCOMPS instance
   * @param id - the entity id
   */
  constructor(mc, id) {
    super(mc, id, kSim);
    this.info = null;             // The sim info or null
    this.job = null;              // The finished Job or null
    this.configFilename =         // The name of the config file
      Simulation.kDefaultConfigFilename;  // (may or may not be config.json)
    this.tree = null;             // The FileTree for this sim
    this.config = null;           // Contents of config.json (or the like)
    this.demographics = null;     // Consolidated demographics
  }

  /**
   * Simulation REST Config object
   * @typedef {Object} SimConfig
   * @property {string} EnvironmentName - the name of the sim's environment
   * @property {int} MaximumNumberOfRetries - the max retries on failure
   * @property {string} Priority - the queue priority for the sim
   * @property {string} ExecutablePath - the job's id as a GUID-string
   * @property {string} SimulationInputArgs - the job's id as a GUID-string
   * @property {int} MinCores - the job's id as a GUID-string
   * @property {int} MaxCores - the job's id as a GUID-string
   * @property {boolean} Exclusive - the job's id as a GUID-string
   */

  /**
   * Simulation REST HPCJob object
   * @typedef {Object} HPCJob
   * @property {string} Id - the job's id as a GUID-string
   * @property {int} JobId - the job's cluster HPC job identifier (an int)
   * @property {string} WorkingDirectory - the job's SAN working directory
   * @property {string} SubmitTime - the job's submission time
   * @property {string} StartTime - the time the job started on the cluster
   * @property {string} EndTime - the time the job ended on the cluster
   * @property {string} Priority - the job's priority, e.g. "Lowest"
   * @property {string} JobState - the job's final state, e.g. "Finished"
   * @property {string} TaskState - the job's task state, varies by environment
   * @property {int} OutputDirectorySize - the size in bytes of the output dir
   * @property {SimConfig} Configuration - the sim config used to run this job
   */

  /**
   * Simulation REST Sim Info object
   * @typedef {Object} SimInfo
   * @property {string} Id - the sim's id as a GUID-string
   * @property {string} Name - the sim name
   * @property {string} Owner - the sim's owner username
   * @property {string} DateCreated - the sim creation datetime (ISO-8601)
   * @property {string} LastModified - the sim modified datetime (ISO-8601)
   * @property {string} SimulationState - the sim's state, e.g. "Finished"
   * @property {FileRec[]} Files - the sim's input files
   * @property {HPCJob[]} HPCJobs - the sim's owner username
   */

  //----------------------------------------------------------------------------
  /**
   * Populates the sim object with sim info, succeeded job, and a file tree.
   * Returns the comps simulation object, with info, job, and tree filled in.
   * Success automatically adds us to the EntityCache.
   * @returns {Simulation|null} - COMPS sim object, or null
   */
  populate() {
    let self = this;
    // Do a two COMPS API calls, then a ton of work to integrate them into a
    // homogenous file tree and other info. This populates:
    //
    // this.info, this.job, this.tree

    // Cache the sim now, even if we can't actually load it up. It will have
    // nulls for the three fields we're filling out.
    const mc = this.mc;
    const ec = mc.getEntityCache();
      ec.add(this);

    let url = `${mc.opts.baseUrl}/api/Simulations/${this.id}?` +
      `format=json&children=files,hpcjobs`;
    if (mc.opts.verbose)
      logInfo$1(`Simulation.populate fetching Sim/${this.id}...`);
    return mc.request(url)
      .then(rawInfo => {
        if (typeof rawInfo === "string") {
          self.info = null;
          self.job = null;
          self.tree = null;
          const msg = "Simulation.populate: COMPS rejected a REST call. Cookie may need refresh.";
          logError$1(msg);
          return Promise.reject({ message: msg });
        } else {
          self.info = rawInfo.Simulations[0];
          const jobs = self.info.HPCJobs;
          self.job = find(jobs, {JobState: "Finished"}); // Lodash find
          if (!self.job) {
            self.job = null;
            logWarn("Simulation.populate: Simulation has no job in Finished state.");
          } else {
            self.configFilename = self._getConfigFilenameFromJob(self.job);
          }
          return Promise.resolve(self);
        }
      })
      .then(sim => {
        return sim._prepareSimFileTree();
      })
      .then(fileTree => {
        self.tree = new FileTree(self.mc, fileTree);
        return Promise.resolve(self);
      })
      .catch(err => {
        logError$1(err.message);
        return Promise.reject(err);
      });
  }

  //----------------------------------------------------------------------------
  /**
   * Retrieve the config data from the config file, or rejects if not found.
   * @returns {Promise<config>} - the config data from config.json or the like
   */
  getConfig() {
    if (this.config)
      return Promise.resolve(this.config);
    if (!this.tree)
      return Promise.reject(
        { message: "Simulation.getConfig called on sim with no file tree"});
    if (!this.tree.contains(this.configFilename))
      return Promise.reject(
        { message: `Simulation.getConfig: cannot find ${this.configFilename}`});

    const self = this;
    return this.tree.getFile(this.configFilename)
      .then(data => {
        self.config = data;
        return Promise.resolve(data);
      })
      .catch(ex => {
        logError$1("Simulation.getConfig: exception, rejecting");
        logObject(ex);
        return Promise.reject(
          { message: `getConfig: Couldn't retrieve config file ${self.configFilename}` });
      });
  }

  //----------------------------------------------------------------------------
  /**
   * Retrieve and coalesce the demographics file and all its overlays. Note that
   * this requires reading all the overlays into memory, and there can be a lot
   * of overlays in some sims. The stored value is the consolidated demo.
   * @returns {Promise<demographics>} - consolidated (overlaid) demographics data
   */
  getDemographics() {
    if (this.demographics)
      return Promise.resolve(this.demographics);

    // Start by getting the config, where the demo filenames are listed
    let self = this;
    return this.getConfig()
      .then(config => {
        // We've got the config, so let's get the list of demographics filenames
        // and make sure they're resolvable.
        const ft = self.getFileTree();
        let filenames = config.parameters.Demographics_Filenames;
        if (!isArray(filenames))
          filenames = [filenames];

        // First peel off the main demo file and look for that
        let mainDemoFn = filenames.shift();
        // Look for the bare filename of the demographics file first
        if (!ft.contains(mainDemoFn)) {
          // If we can't find that, look for the bare demo file in Assets/
          mainDemoFn = `${Simulation.kDemographicsDir}/${mainDemoFn}`;
          if (!ft.contains(mainDemoFn)) {
            return Promise.reject(
              { message: `ERROR: Simulation.getDemographics: Main demographics file not found in / or ${Simulation.kDemographicsDir}`}
            );
          } // else found file in Assets/, use that
        } // else just leave mainDemoFn alone

        // Now check subsequent (overlay) files. They might have partial paths.
        filenames.forEach((fn, i, lst) => {
          if (!ft.contains(fn)) {
            if (!ft.contains(`${Simulation.kDemographicsDir}/${fn}`)) {
              return Promise.reject(
                { message: `ERROR: Simulation.getDemographics: failed to resolve ${fn} in simulation file tree.` }
              );
            } else {
              // Found it in Assets/, so update the path
              lst[i] = `${Simulation.kDemographicsDir}/${fn}`;
            }
          }
        });

        // Finally put the main demo back at the top
        filenames = [ mainDemoFn, ...filenames ];   // Put the main demo back in

        // Go fetch all the files in parallel
        return ft.getFiles(filenames);
      })
      .then(fileContentsArray => {
        if (fileContentsArray.length === 1) {
          // Only one file, no overlays
          self.demographics = fileContentsArray[0];
          return Promise.resolve(self.demographics);
        } else if (fileContentsArray.length > 1) {
          // Multiple files specified, overlay each
          self.demographics = fileContentsArray.shift();  // Grab the first file
          self.demographics = overlayObjects(self.demographics,  // Overlay rest
            fileContentsArray);
          return Promise.resolve(self.demographics);
        } else {
          // No demographics
          return Promise.reject(
            { message: "ERROR: Simulation.getDemographics: No demographics files found."});
        }
      });
  }

  //----------------------------------------------------------------------------
  /**
   * Get the sim information object from the Simulation.
   * @returns {SimInfo|null} - the sim info if populated, else null
   */
  getInfo() {
    return this.info;
  }

  //----------------------------------------------------------------------------
  /**
   * Get the succeeding job from this sim, or null if not found.
   * @returns {HPCJob|null} - The succeeding job for this sim or null
   */
  getJob() {
    return this.job;
  }

  //----------------------------------------------------------------------------
  /**
   * Obtain the complete, normalized file tree for this simulation including
   * input, asset, and output files (for the first succeeded job). If no job
   * succeeded, the file tree will only contain input and asset files.
   * @return {FileTree|null}- the sim file tree or null
   */
  getFileTree() {
    return this.tree;
  }

  //----------------------------------------------------------------------------
  /**
   * Looks for Vis-Tools preprocess dir, and returns the URL to display this sim
   * in the Vis-Tools client. To directly navigate to this URL, do
   * window.location.replace(visToolsUrl). Note that only simulations that have
   * already been pre-processed for Vis-Tools will have this directory.
   * A liberal RE is used to find the visset.json file, but the first one is
   * used.
   * @returns {string|undefined} - the URL to hit to open this sim in
   * the Vis-Tools client. null if there's no Vis-Tools directory, or
   * if the Vis-Tools directory is found but a visset.json is not.
   */
  getVisToolsUrl() {
    if (!this.tree) return;
    const vtFR = this.tree.findFileRecord("/Vis-Tools/");
    if (!vtFR) {
      log$1("Simulation.getVisToolsUrl: no VT dir found");
      return null;
    }
    let vissetUrl = null;
    this.tree.traverse(rec => {
      if (rec.FriendlyName.match(/.*visset.*\.json/ig)) {
        vissetUrl = rec.Url;
        return false;   // Stop traversal
      }
    });
    return vissetUrl ?
      `${this.baseUrl}/vistools/geospatial.html?set=` +
      `${encodeURIComponent(vissetUrl)}` :
      undefined;
  }

  //----------------------------------------------------------------------------
  /**
   * Returns the Directory FileRec for the "Vis-Tools" dir or null. You would
   * use this if you wanted the URLs of the files in the Vis-Tools directory,
   * such as the "visset.json" file.
   * @returns {FileRec|null}
   */
  getVisToolsDir() {
    if (!this.tree) return;
    return this.tree.findFileRecord("/Vis-Tools/");
  }

  //----------------------------------------------------------------------------
  /**
   * Return a human-readable string for this object
   * @returns {string}
   */
  toString() {
    return `[Simulation: ${this.id} with [${this.info ? "√" : " "}] info, ` +
      `[${this.job ? "√" : " "}] job, [${this.tree ? "√" : " "}] tree]`;
  }

  //----------------------------------------------------------------------------
  /**
   * Return a string with detailed information about this Simulation object.
   * Handy for debugging.
   * @returns {string}
   */
  dump() {
    return Simulation.dumpSim(this);
  }

  //----------------------------------------------------------------------------
  /**
   * Helper function for stringifying Simulation objects
   * @param sim - a Simulation object for which you want a descriptive string
   * @returns {string} - a human-readable set of details
   */
  static dumpSim(sim) {
    return `${sim.toString()}\n` +
      `  ${Simulation.dumpInfo(sim.info)}\n` +
      `  ${Simulation.dumpJob(sim.job)}\n` +
      `  ${Simulation.dumpTree(sim.tree)}\n`;
  }

  //----------------------------------------------------------------------------
  /**
   * Helper function for stringifying SimInfo objects
   * @param {SimInfo} simInfo - a SimInfo object for which you want a descriptive string
   * @returns {string} - a human-readable set of details
   */
  static dumpInfo(simInfo) { return simInfo ?
    `[SimInfo ${simInfo.Id} ${simInfo.Owner}/'${simInfo.Name}']` :
    "[not present]"; }

  //----------------------------------------------------------------------------
  /**
   * Helper function for stringifying HPCJob objects
   * @param {HPCJob} job - the target HPCJob object
   * @returns {string} - a human-readable set of details
   */
  static dumpJob(job) { return job ?
    `[Job ${job.Id}/${job.JobId} in ${job.JobState} state]` :
    "[no finished job]"; }

  //----------------------------------------------------------------------------
  /**
   * Helper function for stringifying HPCJob objects
   * @param {FileTree} tree - the target FileTree object
   * @returns {string} - a human-readable set of details
   */
  static dumpTree(tree) { return tree ?
    tree.toString() : "[not present]"; }

  //----------------------------------------------------------------------------
  /**
   * A helper method for visualizations. Calculates the lat-long bounds and the
   * min/max initial population from a collection of Nodes, as found in
   * demographics. Eventually will end up in a Demographics class.
   * @param nodes
   * @returns {{maxPopulation, minPopulation,
   *   bounds: {maxLat, minLat, minLng, maxLng}}} - node stats
   */
  static calcNodeStats(nodes) {
    let minLat, minLng, maxLat, maxLng, minPop, maxPop;
    nodes.forEach((node, i) => {
      let na = node.NodeAttributes;
      if (!i) {
        minLat = na.Latitude; maxLat = na.Latitude;
        minLng = na.Longitude; maxLng = na.Longitude;
        minPop = na.InitialPopulation;
        maxPop = na.InitialPopulation;
      }
      else {
        minLat = na.Latitude < minLat ? na.Latitude : minLat;
        maxLat = na.Latitude > maxLat ? na.Latitude : maxLat;
        minLng = na.Longitude < minLng ? na.Longitude : minLng;
        maxLng = na.Longitude > maxLng ? na.Longitude : maxLng;
        minPop = na.InitialPopulation < minPop ? na.InitialPopulation : minPop;
        maxPop = na.InitialPopulation > maxPop ? na.InitialPopulation : maxPop;
      }
    });
    return {
      bounds:
        // [ [ minLng, minLat ],
        //   [ maxLng, maxLat ] ],
        [ [ minLat, minLng ],
          [ maxLat, maxLng ] ],
      minPopulation: minPop,
      maxPopulation: maxPop,
    };
  }

  //----------------------------------------------------------------------------
  // Implementation
  //----------------------------------------------------------------------------
  /**
   * Coordinates the parallel I/O and post-processing necessary to build the
   * normalized simulation file tree. Called internally.
   * @returns {Promise<[FileRec]>} - the file tree
   * @private
   */
  _prepareSimFileTree() {
    let self = this;
    if (!this.info) return Promise.reject(
      { message: "Simulation._prepareSimulationFileTree(): No sim info"});

    let outputsArray;
    return self._getRawOutputListings()   // This works even if job is null
      .then(rawOutputArrays => {  // There are always two
        outputsArray = [
          get(rawOutputArrays, "[0].Resources", []),  // First raw output array's Resources
          get(rawOutputArrays, "[1].AssetCollections[0].Assets", [])   // Second raw output array's Resources
        ];
        return Promise.resolve(outputsArray);
      })
      .then(outputs => {
        return self._prepareOutput(self.info, outputs);
      });
  }

  //----------------------------------------------------------------------------
  /**
   * Raw I/O for getting raw output listing and asset collection listing. This
   * function is tolerant of sims that don't have a job in Finished state. In
   * such case only input and asset files are in the tree, because there are no
   * output files.
   * @private
   * @returns {Promise<any[]>} - array of file contents
   * [simOutputListing, assetOutputListing], where the latter entry will only
   * be present if there's an Asset Collection (which there usually is).
   */
  _getRawOutputListings() {    // Returns a promise
    let self = this;
    if (this.job === null) {
      // Make a result with the input files but no output files
      return Promise.resolve([
        { Resources: this.info.Files },
        { AssetCollections: [{ Assets: [] }] },
      ]);
    }
    // This is the Promise version of async.parallel(). Unlike async.parallel,
    // you put promises in the array, not functions.
    let ioPromises = [];
    ioPromises.push(self._getSimOutputFiles(this.id, this.job));
    if ("AssetCollectionId" in this.job.Configuration)
      ioPromises.push(self._getOutputAssetListing(
        this.job.Configuration.AssetCollectionId));
    return Promise.all(ioPromises);
  }

  //----------------------------------------------------------------------------
  /**
   * Get the output file listing, not following symlinks, tree output.
   * NOTE: The records returned from this function are not the same as the
   * ones returned by _getOutputAssetListing.
   * @param {string} simId - the sim's id (a GUID)
   * @param {Job} job - the succeeding job (a COMPS Job record)
   * @returns {Promise<any>} - Promise for sim output files
   */
  _getSimOutputFiles(simId, job) {
    // Ask the COMPS asset manager for the sim's output.
    return this.mc.request(
      `${this.mc.opts.baseUrl}/asset/Simulations/${simId}/output/?hpcjobid=${job.Id}&format=json&followSymLinks=0&flatten=0&zip=0`,
    )
  }

  //----------------------------------------------------------------------------
  /**
   * Get an asset collection file listing.
   * NOTE: The records returned from this function are not the same as the
   * ones returned by _getSimOutputFiles.
   * @param {string} acId - the asset collection's id (a GUID)
   * @returns {Promise<any>} - Promise for COMPS AssetCollection listing
   */
  _getOutputAssetListing(acId) {    // Returns a promise
    // Ask the COMPS asset manager for the sim's asset listing.
    return this.mc.request(
      `${this.mc.opts.baseUrl}/api/AssetCollections/${acId}/?children=assets&format=json`,
    )
  }

  //----------------------------------------------------------------------------
  /**
   * Given simInfo and the array of listings, combine and normalize.
   * @private
   * @param {object} simInfo - the getSimInfo() result
   * @param {any[]} outputsArrays - the _getRawOutputListing() result
   * @returns {Promise<fileRec[]>} - combined and normalized file tree
   */
  _prepareOutput(simInfo, outputsArrays) {    // Returns a promise
    let result = outputsArrays[0];
    let acTree = this._convertAssetFileList([], outputsArrays[1]);
    let acIndex = findIndex(result, {
      Type: "SymLinkDirectory",
      FriendlyName: "Assets"
    });
    if (acIndex !== -1) {
      result[acIndex] = acTree[0];
      result[acIndex].PathFromRoot = result[acIndex].RelativePath;
      delete result[acIndex].RelativePath;
    }
    return Promise.resolve(result);
  }

  //----------------------------------------------------------------------------
  _convertAssetFileList(entityFiles, acList) {
    /**
     * This is how you make the sausage right here, and really, the reason I wrote
     * this library in the first place. The present function (which creates a
     * normalized, tree-structured, complete output file listing from COMPS) is a
     * huge PITA that resulted from differences between how input files are
     * handled and how the Asset Manager handles them. So this bit of
     * super-painful code is adapted from COMPS explore.js code that Peter, David
     * and I have already sweated over. With any luck, no one will ever need to
     * write this again. Most of the credit for this code goes to David. :-)
     * @private
     * @param {object[]} entityFiles - the raw input file listing
     * @param {object[]} [acList] - the raw fAsset Collection listing
     * @returns {fileRec[]} - the combined and normalized inputs
     */
    let mainDir = [];
    let assetCollectionDir = {
      Id: "AssetCollFolderId",
      Type: "Directory",
      FriendlyName: "Assets",
      Items: [],
      Length: 0,
      RelativePath: "."
    };

    //..........................................................................
    /**
     * Recursively create directory fileRecs.
     * @private
     * @param {fileRec[]} dirs - directories
     * @param {string} rootDir - name to use for root directory
     * @returns {fileRec[]} - tree with directories in place
     */
    let createDirs = function (dirs, rootDir) {
      if (!dirs || dirs.length === 0) {
        return rootDir;
      }

      if (dirs.length > 0) {
        if (findIndex(rootDir.Items, {FriendlyName: dirs[0]}) === -1) {
          rootDir.Items.push({
            Id: generateGuid(),
            Type: "Directory",
            FriendlyName: dirs[0],
            Items: [],
            Length: 0,
            RelativePath: rootDir.FriendlyName,
          });
        }
        return createDirs(dirs.slice(1),
          find(rootDir.Items, {FriendlyName: dirs[0]}));
      }
    };

    //..........................................................................
    /**
     * Converts an asset-type listing entry into the normalized kind we output.
     * @private
     * @param {object} asset - a single raw asset file listing
     * @returns {fileRec} - normalized fileRec for that asset
     */
    let convertAssetToModel = function(asset) {
      return {
        Id: asset.MD5Checksum, // + ":" + asset.RelativePath,
        Type: "File",
        MD5: asset.MD5Checksum,
        FriendlyName: asset.FileName,
        Length: asset.Length,
        Url: asset.Uri,
        RelativePath: "Assets\\" + (asset.RelativePath ? asset.RelativePath : "")
      }
    };

    //..........................................................................
    /**
     * Given a relative path and root directory name, and an asset, create a
     * normalized fileRec.
     * @private
     * @param {string} relativePath - normalized path for this asset
     * @param {fileRec} rootDir - root directory normalized fileRec
     * @param {object} asset - the single asset in question
     */
    let createDirsAndFile = function (relativePath, rootDir, asset) {
      if (!relativePath || relativePath === "") {
        rootDir.Items.push(convertAssetToModel(asset));
      } else {
        let dirs = relativePath.split("\\");
        if (relativePath !== "" && dirs.length > 0) {
          // directory has not been created yet
          let targetDir = createDirs(dirs, rootDir);
          targetDir.Items.push(convertAssetToModel(asset));
        }
      }
    };

    //..........................................................................
    /**
     * Calculate folder size.
     * @param {fileRec} folder - the dir rec for which to calculate size
     * @returns {number} - total size in bytes of all files in this immediate
     * directory, but not recursively.
     */
    let calculateFolderSize = function (folder) {
      let totalSize = 0;
      folder.Items.forEach(function (item) {
        if (item.Type === "File") {
          totalSize += item.Length;
        } else if (item.Type === "Directory") {
          totalSize += calculateFolderSize(item);
        }
      });
      folder.Length = totalSize;
      return totalSize;
    };

    if (acList) {
      acList.forEach(function (asset) {
        createDirsAndFile(asset.RelativePath, assetCollectionDir, asset);
      });
      mainDir.push(assetCollectionDir);
      assetCollectionDir.Length = calculateFolderSize(assetCollectionDir);
    }

    if (entityFiles) {
      entityFiles.forEach(function (entityFile) {
        mainDir.push({
          Id: entityFile.MD5Checksum,
          MD5: entityFile.MD5Checksum,
          Type: "File",
          FriendlyName: entityFile.FileName,
          Length: entityFile.Length,
          Url: entityFile.Uri,
          RelativePath: ""
        });
      });
    }
    return mainDir;
  }

  //----------------------------------------------------------------------------
  // Implementation
  //----------------------------------------------------------------------------
  _getConfigFilenameFromJob(job) {
    if (!this.job)
      return Simulation.kDefaultConfigFilename;

    let parts = this.job.Configuration.SimulationInputArgs.split(" ");
    while (parts.length > 0 && parts.shift() !== "--config") {
      // nothing
    }
    return parts.length > 0 ? parts[0] : Simulation.kDefaultConfigFilename;
  }
} // Class Simulation

/**
 * @module MicroCOMPS
 * MicroCOMPS module.
 */
//==============================================================================
// MicroCOMPS
//==============================================================================
/**
 * @class
 * MicroCOMPS main class
 */
class MicroCOMPS {
  //----------------------------------------------------------------------------
  // Constants & defaults
  //----------------------------------------------------------------------------
  static kEncode = true;
  static kNoEncode = false;
  static kDecode = true;
  static kNoDecode = false;
  static kTurnkeyUI = true;
  static kNoTurnkeyUI = false;

  //----------------------------------------------------------------------------
  // Constructor options object
  //----------------------------------------------------------------------------
  /**
   * options is the options object type for the MicroCOMPS constructor
   * @typedef {Object} options
   * @property {string} baseUrl - base COMPS url (e.g "https://comps.idmod.org")
   * @property {string} token - a valid COMPS session token
   * @property {object} logger - an override logger object (see Logging.js)
   * @property {boolean} verbose - emit extra logging info if true
   */
  static kDefaultOptions = {
    baseUrl: null,
    token: null,
    verbose: false,    // true during development
  };

  //----------------------------------------------------------------------------
  // Constructor
  //----------------------------------------------------------------------------
  /**
   * MicroCOMPS constructor.
   * @example
   * // Typical usage with no arguments, for use in a COMPS web browser iframe
   * // context. The baseUrl and token are extracted from the COMPS cookie.
   * let mc = MicroCOMPS();
   * @example
   * // Usage with options. Use this in a windowless environment like NodeJS or
   * // any time you have an externally-available COMPS token.
   * let mc = MicroCOMPS({
   *   baseUrl: "https://comps-dev.idmod.org",
   *   token: myCompsToken,
   * });
   * @class
   * @property {boolean} authStarted - recursion brake for auth
   * @property {options} opts - the currently-applied options object
   * @property {EntityCache} entityCache - a cache of COMPS entities
   * @property {function} signinHandler - ref to our signin handler
   * @property {function} signoutHandler - ref to our signin handler
   * @property {function} accessHandler - ref to our signin handler
   * @param {options} options - an object containing MicroCOMPS initial options
   */
  constructor(options) {
    // Initialize own properties
    this.opts = clone(MicroCOMPS.kDefaultOptions);
    this.entityCache = new EntityCache();
    let self = this;

    // Layer user options over our defaults
    if (options)
      this.opts = assign$1(this.opts, options);

    // If a logger was given, plug it in now before we do anything that's likely
    // to fail. We want to make sure any init-time problems are logged.
    if ("logger" in this.opts) {
      setGlobalLogger(this.opts.logger);
    } else if (getGlobalLogger() === null) {
      setGlobalLogger(console);
    }  // else leave whatever global logger is installed in place

    // Look for a baseUrl and token.
    if (this.opts.baseUrl && !this.opts.baseUrl.startsWith("http")) {
      if (typeof window !== "undefined") {
        this.opts.baseUrl = window.location.protocol + this.opts.baseUrl;
      } else this.opts.baseUrl = "https://" + this.opts.baseUrl;
    }
    if (!this.opts.baseUrl)
      this.opts.baseUrl = MicroCOMPS.findBaseUrl();
    this.opts.baseUrl = cleanBaseUrl(this.opts.baseUrl);
    if (!this.opts.token)
      this.opts.token = MicroCOMPS.findToken(this.opts.baseUrl);

    if (typeof window !== "undefined") {
      window.addEventListener("message", evt => { self._onCOMPSMessage(evt); });
    }

    // Store function refs for our auth callbacks. Storing these refs allows us
    // to disconnect them later. Also doing it this way allows us to use
    // instance functions instead of statics or loose functions.
    //this._authSetup();

    if (this.opts.verbose)
      log(`MicroCOMPS.ctor: out, with token: ${
        this.opts.token ? humanizeToken(this.opts.token) : "NULL"}`);
  }

  //----------------------------------------------------------------------------
  // Simulations
  //----------------------------------------------------------------------------
  /**
   * Returns a promise for a Simulation object on the sim with the given id and
   * attempts a series of REST calls on it to populate it with job and file tree
   * data.
   * @async
   * @param id - id of Simulation entity to look up
   * @return {Promise<Simulation>|null} - Promise for a populated Simulation
   */
  getSimulation(id) {
    if (this.entityCache.has(id)) {
      if (this.opts.verbose)
        log(`MicroCOMPS.getSimulation returning cached sim ${id}`);
      return Promise.resolve(this.entityCache.get(id));
    }
    let sim = new Simulation(this, id);
    return sim.populate();    // Populate will add the sim to the cache
  }

  //----------------------------------------------------------------------------
  // I/O
  //----------------------------------------------------------------------------
  /**
   * Sends a GET on the given url, and allows specification of the responseType
   * and automatically includes the X-COMPS-Token header. Suitable for obtaining
   * both text and binary sim outputs. The default responseType is "json".
   * @async
   * @param {string} url - the URL to fetch
   * @param {string} responseType - the response type, e.g. "text" or "arraybuffer"
   * @see https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/responseType
   * @see https://axios-http.com/docs/req_config
   * @returns {Promise<*>} - the URL's response data
   */
  request(url, responseType="json") {
    // This is a chimney, but it already saved me once. Leaving this here makes
    // it easier to swap out the underlying I/O tech.
    let opts = {
      url: url,
      headers: { "X-COMPS-Token": this.opts.token }
    };
    if (isString(responseType))
      opts.responseType = responseType;
    return axios(opts)
      .then(resp => Promise.resolve(resp.data))
      .catch(reason => Promise.reject(reason));
  }

  //----------------------------------------------------------------------------
  // Accessors
  //----------------------------------------------------------------------------
  /**
   * Get the current COMPS host url, e.g. "https://comps.idmod.org"
   * @returns {string|*} - the current COMPS endpoint url
   */
  getBaseUrl() {
    return this.opts.baseUrl;
  }

  //----------------------------------------------------------------------------
  /**
   * Get the current COMPS token. Normally you'll never need this, but if you
   * want to do a direct COMPS REST call yourself you'll need the token for
   * your request headers. See get().
   * @returns {string} current COMPS token
   */
  getToken() {
    return this.opts.token;
  }

  //----------------------------------------------------------------------------
  /**
   * Get MicroCOMPS entity cache. This is used internally, but the cache is
   * available and contains the accumulated results of all this session's
   * COMPS REST calls.
   * @returns {EntityCache}
   */
  getEntityCache() {
    return this.entityCache;
  }

  //----------------------------------------------------------------------------
  /**
   * Return the current options object. This contains the current baseUrl,
   * token, and logger, among other useful bits.
   * @returns {Options} - options object
   */
  getOptions() {
    return this.opts;
  }

  //----------------------------------------------------------------------------
  /**
   * Change MicroCOMPS options after the fact.
   * @param {options} options - an {options} object containing new settings
   */
  setOptions(options) {
    assign$1(this.opts, options);
    // If caller changed logger after construction, plug it into the global so
    // all the static log functions will use it.
    if (("logger" in options) && options.logger) {
      setGlobalLogger(options.logger);
    }
    if (("baseUrl" in options))
      this.opts.baseUrl = cleanBaseUrl(this.opts.baseUrl);
    if (this.opts.verbose)
      logInfo(`MicroCOMPS.setOptions: updated keys [${Object.keys(options)}]`);
  }

  //----------------------------------------------------------------------------
  /**
   * Obtain the version number for MicroCOMPS
   * @returns {String} - the library version
   */
  static getVersion() {
    return VERSION;
  }

  //----------------------------------------------------------------------------
  /**
   * Returns whether the MicroCOMPS object is in a state where it can make REST
   * calls to COMPS. That means it needs a valid endpoint and token. This
   * function does not
   * @returns {boolean} whether we have an endpoint + token or not.
   */
  isViable() {
    let test1 = this.opts.baseUrl.startsWith("http");
    let test2 = this.opts.token !== null;
    let result = test1 && test2;
    if (this.opts.verbose) {
      logInfo(`MicroCOMPS.isViable returning ${result} b/c ` +
        `${test1 ? "" : "bad baseUrl"}${test2 ? "" : "bad token"}`);
    }
    return test1 && test2;
  }

  //----------------------------------------------------------------------------
  /**
   * Return a human-readable string for this object
   * @returns {string}
   */
  toString() {
    return `[MicroCOMPS: ${this.opts.baseUrl}/${humanizeToken(this.opts.token)}]`;
  }

  //----------------------------------------------------------------------------
  /**
   * Return the version of the MicroCOMPS library
   * @returns {string} - the semver for the library
   */
  getVersion() {
    return VERSION
  }

  //----------------------------------------------------------------------------
  // Static utility methods
  // These methods are used during MicroCOMPS startup to glean host, token, and
  // simId information from outside sources.
  //----------------------------------------------------------------------------
  /**
   * Static helper function that tries to derive a baseUrl from a number of
   * possible sources. Always returns a valid baseUrl.
   * @static
   * @returns {string} - a baseUrl, e.g. "https://comps.idmod.org"
   */
  static findBaseUrl() {
    let result = undefined;

    // Here we successively look for a COMPS baseUrl. Any stage that works
    // short circuits the rest.

    // Case 1: Are we running in Node where there's no 'window' or 'document'?
    if (typeof window === "undefined") {
      // We're in Node or something, so there's no URL or cookie, and the user
      // has not specified a baseUrl in the options, so use a default
      result = "https://" + kDefaultBaseHostname;
    }

    // Case 2: If the baseUrl was provided as an URL param, use that
    if (!result) {
      const params = new URLSearchParams(window.location.search);
      result = params.get("baseUrl");
      if (result)
        result = decodeURIComponent(result);   // Null if not found
    }

    // Case 3: Nothing specified, so conjure a baseUrl based on window.location
    if (!result) {
      let host = window.location.host;
      if (isLocalhost(host)) {
        // Must be a developer, so just point at dev, and preserve protocol
        result = `${window.location.protocol}//${kDefaultDevBaseHostname}`;
      } else {
        // Not a developer, o see if it is one of the known COMPS hosts
        if (window.location.hostname.startsWith("comps"))
          result = window.location.origin;  // e.g. "https://comps-dev.idmod.org"
      }
    }

    // Case 4: We tried everything we can think of, default to prod.
    if (!result) {
      result = "https://" + kDefaultBaseHostname;
    }

    return result;
  }

  //----------------------------------------------------------------------------
  /**
   * Static helper method that tries to find a COMPS token in the cookie.
   * Accesses document, so this method won't work from node.js.
   * @static
   * @param {string} userBaseUrl - OPTIONAL if provided, the baseUrl to use,
   * otherwise the parsed url will be used to find the baseUrl.
   * @returns {(string|null)} - the COMPS token, or null
   */
  static findToken(userBaseUrl) {
    let result = null;    // The COMPS-auth convention is null for non-tokens

    // Here we successively look for a COMPS token. Any stage that works short
    // circuits the rest.

    // Case 1: Are we running in Node where there's no 'window' or 'document'?
    if (typeof window === "undefined") {
      return result;    // If running in node, construct with a token
    }

    // Case 2: If the token was provided as an URL param
    /*if (!result)*/ {
      const params = new URLSearchParams(window.location.search);
      result = params.get("token");
      if (result)
        result = decodeURIComponent(result);   // Null if not found
    }

    // Case 3: If there's a COMPS cookie, use that token
    if (!result) {
      let baseUrl = userBaseUrl ? userBaseUrl : MicroCOMPS.findBaseUrl();
      let hostname;
      try { hostname = new URL(baseUrl).hostname; }
      catch(err) {
        logError(err);
        return null;
      }
      // may be null
      let token = getCookie(`Token-${hostname}`, null, MicroCOMPS.kDecode);
      if (token)
        result = token;
    }

    // We tried everything, return what we found, or null
    return result;
  }

  //----------------------------------------------------------------------------
  /**
   * Look for *any* COMPS token, in production, then dev, then localhost order.
   * Returns the first found viable (baseUrl, token) combo, else null. This
   * method is present because it is useful for tests.
   * @returns {[{string},{string}]|[null,null]} - [baseUrl, token] or null
   */
  static findAnyToken() {
    // Here we look for a COMPS token by iterating over hosts in a preset order
    // Of note: The cookie keys substitute '.' for ':' so I do that here too.
    let hosts = ["comps.idmod.org", "comp2.idmod.org", "comps-dev.idmod.org",
      "localhost:41523", "127.0.0.1:41523"];
    for (let host of hosts) {
      const key = `Token-${host.replace(":", ".")}`;
      let token = getCookie(key, null, MicroCOMPS.kDecode);
      if (token) {
        let protocol = host.startsWith("localhost") ? "http" : "https";
        if (token)
          return [`${protocol}://${host}`, token];
      } else if (typeof window !== "undefined" && "comps_instance" in window) {
        // Try using postMessage if it looks like we're in COMPS
        window.comps_instance.postMessage({
          get: "comps.auth.getTokenAsync",
          observer: window.location.href,
          callback: "onSendToken"
        });
      }
    }
    return [null, null];
  }

  //----------------------------------------------------------------------------
  /**
   * Static helper method that tries to find a simId in the URL and
   * selected-entity in the cookie.
   * @static
   * @returns {(string|undefined)} - GUID sim id or undefined
   */
  static findSimId() {
    if (typeof window === "undefined")
      return;
    let simId;
    const params = new URLSearchParams(window.location.search);
    simId = params.get("simId");
    if (!simId) {
      simId = undefined;
      let hostEntity = getCookie("selected-entity", null);
      try {
        if (hostEntity) hostEntity = JSON.parse(hostEntity);
        if (hostEntity && hostEntity.entity === kSim)
          simId = hostEntity.id;
      } catch(e) {}
    }
    return simId;
  }

  //----------------------------------------------------------------------------
  /**
   * Handle incoming messages from COMPS. This only happens after we make a
   * postMessage call to COMPS. Currently there's only one call, but if you add
   * more, put a switch on the message
   * @param evt
   * @private
   */
  _onCOMPSMessage(evt) {
    const resp = get(evt, "data.response");
    if (resp)
      this.opts.token = resp;
  }

} // class MicroCOMPS

export { Entity, EntityCache, FileRec, FileTree, MicroCOMPS, Simulation, SpatialBinary, VERSION, adjustColors, appendIfUnique, basename, byteClamp, clamp, clampIncl, clampNormIncl, cleanBaseUrl, cleanForHtml, cleanTags, colorObjToHash, contrastRatio, customElementsDefineSafe, deleteCookie, filterInsetChannels, flattenObject, focusAndSelectAll, forEachCookie, generateGuid, getCookie, getCssVariable, getGlobalLogger, hashToColorObj, hslToRgb, humanizeToken, inIFrame, isLocalhost, isValidGuid, kAC, kAssetCollections, kDefaultBaseHostname, kDefaultBaseUrl, kDefaultDevBaseHostname, kDefaultDevBaseUrl, kExp, kExperiments, kLocalhostAliases, kSim, kSimulations, kSte, kSuites, kWI, kWorkItems, log$1 as log, logClear, logError$1 as logError, logInfo$1 as logInfo, logObject, logWarn, luminance, overlayObject, overlayObjects, parseHTML, pointInRect, rgbToHsl, setCookie, setGlobalLogger, shallowCompare, stopEvent, stripExtension, toTitleCase, tokenToString };
//# sourceMappingURL=microcomps.js.map
