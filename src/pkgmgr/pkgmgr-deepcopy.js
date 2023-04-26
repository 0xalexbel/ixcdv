import * as types from '../common/common-types.js';
import { toRelativePath } from '../common/fs.js';
import assert from 'assert';

/**
 * @param {string | types.Package} pkg 
 * @param {string=} relativeToDirectory 
 * @returns {string | types.Package}
 */
export function deepCopyPackage(pkg, relativeToDirectory) {
    if (!pkg) {
        throw new TypeError('Invalid argument');
    }
    if (typeof pkg === 'string') {
        return (relativeToDirectory) ? toRelativePath(relativeToDirectory, pkg) : pkg;
    }

    const newPkg = { ...pkg };
    if (pkg.dependencies) {
        newPkg.dependencies = {};
        const depNames = Object.keys(pkg.dependencies);
        for (let i = 0; i < depNames.length; ++i) {
            const name = depNames[i];
            const dep = pkg.dependencies[name];
            if (!dep) {
                continue;
            }
            if (typeof dep === 'string') {
                newPkg.dependencies[name] = pkg.dependencies[name];
            } else {
                const copy = deepCopyPackage(dep, relativeToDirectory);
                assert(typeof copy === 'object');
                newPkg.dependencies[name] = copy;
            }
        }
        newPkg.dependencies = { ...pkg.dependencies };
    }
    if (relativeToDirectory) {
        newPkg.directory = toRelativePath(relativeToDirectory, newPkg.directory);
    }
    return newPkg;
}