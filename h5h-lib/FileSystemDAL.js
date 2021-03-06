const fsx = require('fs-extra');
const path = require('path');
const os = require('os');
const dirCompare = require('dir-compare');
const uuidV4 = require('uuid/v4');
const recursiveRead = require('fs-readdir-recursive');

const TEMP_PATH = 'temp-res'; //must grant write permission to the web app process.
const PATH_PREFIX = 'h5p-';

const DEFAULT_ENCODING = 'utf-8';

/**
 * This class act as default storage
 * system for the web-app working
 * with the H5P Framework.
 * To be compliant with the first
 * implementation of the H5P Framework
 * (developed in PHP), this class
 * makes use of the OS file-system
 * to as data storage.
 *
 * https://h5ptechnology.atlassian.net/browse/HFP-1202
 */
class FileSystemDAL {

    /**
     * Check if the resource exists to
     * the given path.
     * @param pathToResource {string}
     * @returns {Promise.<boolean>} true if resource exists
     */
    static async resourceExists(pathTo){
        pathTo = path.resolve(pathTo);
        return await fsx.pathExists(pathTo);
    };

    /**
     * Reads the content of the given
     * resource as text and returns it.
     * @param pathTo {string}
     * @param [encoding] {string} default is UTF-8
     * @return {Promise.<string>}
     */
    static async readResourceAsText(pathTo,encoding){
        pathTo = path.resolve(pathTo);
        encoding = encoding || DEFAULT_ENCODING;
        return await fsx.readFile(pathTo,encoding);
    };

    /**
     * Reads the content of the given
     * path and returns it as a stream.
     * @param pathTo {string}
     * @return {Promise.<Buffer>}
     */
    static async readResource(pathTo){
        pathTo = path.resolve(pathTo);
        return await fsx.readFile(pathTo);
    };

    /**
     * Writes the given content to
     * the the provided file path.
     * @param pathTo {string}
     * @param content {string}
     * @param [encoding] {string}
     * @return {Promise.<*>}
     */
    static async writeResource(pathTo,content,encoding){
        pathTo = path.resolve(pathTo);
        encoding = encoding || DEFAULT_ENCODING;
        return await fsx.writeFile(pathTo,content,encoding);
    }

    /**
     * Async and recursively deletes a tree, if any.
     * @param pathTo {string}
     * @returns {Promise.<void>}
     * @php H5PCore deleteFileTree
     */
    static async deepDelete(pathTo){
        pathTo = path.resolve(pathTo);
        if(await fsx.pathExists(pathTo))
            await fsx.remove(pathTo);
    };

    /**
     * Async and recursively copies a tree,
     * and makes sure the clone actually has
     * all contents of the original
     * and returns the result.
     * @param from {string}
     * @param to {string}
     * @param applyFilter {boolean}
     * @param [filterOpts] {object}
     * @returns {Promise.<boolean>} true when the copy
     * was fully completed
     * @php H5PDefaultStorage copyFileTree
     */
    static async deepCopy(from, to, applyFilter, filterOpts){

        //tracks copy completion
        let completed = false;

        let absFrom = path.resolve(from);
        let absTo = path.resolve(to);

        //filtering the list of file to
        //copy is optional
        if(applyFilter)
        {
            //collect the full files list from
            //the given path, then returns a filtered
            //list of them according to the filter
            //options provided (or default once)
            let filter = await this.filterFilesToIgnore(from,filterOpts);

            //performs the copy of the files
            for(let fileName of filter.allowedList){
                let originalFileName = path.join(absFrom,fileName);
                let copyFileName = path.join(absTo,fileName);
                await fsx.copy(originalFileName,copyFileName)
            }

            //now checks that copied files and original
            //once (filtered) are exactly the same
            let copiedFiles = await recursiveRead(absTo);
            completed = (copiedFiles.sort().join()===filter.allowedList.sort().join());
        }
        else{
            //no filter to apply, just copies all files
            //and check that copy is fully compliant
            await fsx.copy(absFrom,absTo);
            let result = await dirCompare.compare(absFrom,absTo);
            completed = (result.differences===0);
        }

        return completed;
    };

    /**
     * Copy a file from path to path.
     * @param from {string}
     * @param to {string}
     * @return {Promise.<void>}
     */
    static async copyResource(from, to){
        let absFrom = path.resolve(from);
        let absTo = path.resolve(to);
        await fsx.copy(absFrom,absTo);
    }

    /**
     * Deletes the given single resource
     * at the given path.
     * @param pathTo {string}: path to the resource to delete
     * @return {Promise.<void>}
     */
    static async deleteResource(pathTo){
        await fsx.remove(path.resolve(pathTo));
    }

    /**
     * Makes sure you get the path
     * you need
     * @param pathNeeded {string}
     * @return {Promise.<*>}
     */
    static async ensurePath(pathNeeded){
        return await fsx.ensureDir(pathNeeded);
    };

    /**
     * Gets the reference to a writable
     * temporary path where the app can
     * store data.
     * In this implementation the async
     * is not really needed but it is
     * declared in the super class signature
     * so let's keep it as is.
     * @param basePath
     * @return {Promise.<*>}
     */
    static async getWritableTempPath(basePath) {
        return new Promise((resolve)=>{
             resolve(path.join(basePath,TEMP_PATH,PATH_PREFIX,uuidV4()));
        });
    }

    /**
     * Returns an array os file names
     * from the given path removing
     * from it all files that must
     * be ignored according to the
     * "ignoreOpts" param.
     * This is used while making deep
     * copies (see .deepCopy) to avoid
     * to copy files and folders that
     * actually should not, even if they
     * are included in the .h5p package.
     * For instance .git files.
     *
     * NOTE: does not include dirs, works by file only
     *
     * @param pathTo
     * @param [ignoreOpts] {object}
     * Default:
     *      equalTo:['.','..'],
     *      hasExtension:['.git','.gitignore','.h5pignore'],
     *      isListedIn:['.h5pignore']
     * @return {Promise.<object>}
     */
    static async filterFilesToIgnore(pathTo, ignoreOpts){

        //by default the filter will ignore
        //files from the path that meet the
        //following conditions:
        ignoreOpts = ignoreOpts || {
            equalTo:['.','..'], //file names equal to these
            hasExtension:['.git','.gitignore','.h5pignore'], //file names with these extensions
            isListedIn:['.h5pignore'] //file names explicitly listed here
        };

        //gets the path where files to check are...
        let absFrom = path.resolve(pathTo);

        //the list of files that are
        //allowed (not matching the
        // filters) and will be returned
        //as safe files list
        let allowedList = [];

        //first of all looks at the "isListedIn"
        //filter options, finds the black listing
        //files (if any), then add all the file
        //names from the black list in the
        //"equalTo" filter option (checked later on)
        for(let ignoreFile of ignoreOpts.isListedIn){
            ignoreFile = path.join(absFrom,ignoreFile);

            //looks for black file list
            if(await fsx.exists(ignoreFile))
            {
                //gets the list of files in the black list
                let fileContent = await fsx.readFile(ignoreFile, 'utf-8');
                if(fileContent.length>0)
                    ignoreOpts.equalTo = ignoreOpts.equalTo.concat(fileContent.split(os.EOL));
            }
        }

        //starts reading the list of files
        //from the path you need to check
        //NOTE: does not include dirs, works by file only
        (await recursiveRead(absFrom)).forEach((file)=>{

            let fileIsAllowed = true;

            //is the current file in the black list? => not allowed
            for(let entry of ignoreOpts.equalTo)
            {
                if(entry===file){
                    fileIsAllowed = false;
                    break;
                }
            }

            //has the current file an invalid extension? => not allowed
            for(let ext of ignoreOpts.hasExtension)
            {
                if(file===ext || path.extname(file)===ext){
                    fileIsAllowed = false;
                    break;
                }
            }

            //did the current file pass the filters?
            // => allowed and returned with file name
            if(fileIsAllowed) allowedList.push(file);

            //useful output on test result report once exported
            console.log('File: ' + file + ' | allowed: '+fileIsAllowed);
        });

        //returns the list of filtered
        //files as well as the filter
        //options (useful for testing
        // the results)
        return {
            allowedList:allowedList,
            ignoreOpts:ignoreOpts
        };
    }

    /**
     * List of files available files
     * from the given path.
     * @param pathTo {string}
     * @return {Promise.<string>}
     */
    static async readDir(pathTo){
        pathTo = path.resolve(pathTo);
        return await recursiveRead(pathTo);
    }

    /**
     * Returns true if the given path
     * has writable access.
     * @param pathTo {string}
     * @return {boolean}
     */
    static async isPathWritable(pathTo){
        try{
            await fsx.access(path.resolve(pathTo), fsx.W_OK);
            return true;
        }
        catch (err){
            return false;
        }
    }

    /**
     * Gets the node "path" module.
     * @type {path}
     */
    static getPath(){ return path; }

}

module.exports = FileSystemDAL;