import assert from 'assert';

/**
 * @param {string} args 
 */
export function springClassPathParseRepoDir(args) {
    const searchStr = '/build/classes/java/main:';
    const i3 = args.indexOf(searchStr);
    if (i3 < 0) {
        return;
    }
    const s1 = args.substring(0, i3);
    const i1 = s1.lastIndexOf(' ');
    const s2 = s1.substring(i1 + 1, i3);
    const i2 = s2.lastIndexOf(':');

    const dir = (i2 < 0) ?
        s1.substring(i1 + 1) :
        s1.substring(i2 + 1);
    return dir;
}

/**
 * @param {string} args 
 */
export function springArgsParseSpringConfigLocation(args) {
    const searchStr = " --spring.config.location=";
    const i0 = args.indexOf(searchStr);
    if (i0 < 0) {
        return;
    }

    const i1 = args.indexOf(" ", i0 + searchStr.length);
    const directory = (i1 >= 0) ?
        args.substring(i0 + searchStr.length, i1) :
        args.substring(i0 + searchStr.length);
    assert(directory.charAt(directory.length - 1) === '/');
    return directory.substring(0, directory.length - 1);
}
