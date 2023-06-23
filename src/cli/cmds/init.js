import { Cmd } from "../Cmd.js";
import { Inventory } from "../../services/Inventory.js";
import { isNullishOrEmptyString } from "../../common/string.js";

export default class InitCmd extends Cmd {

    static cmdname() { return 'init'; }

    /**
     * @param {string} cliDir 
     * @param {string | undefined} directory 
     * @param {*} options 
     */
    async cliExec(cliDir, directory, options) {
        try {
            if (!directory || isNullishOrEmptyString(directory)) {
                directory = cliDir;
            }

            const vars = this.parseVars(options);

            const inventory = await Inventory.newDefault(directory, options, vars);
            await inventory.saveConfigFile({ directory, overrideExistingFile: options.force });
        } catch(err) {
            this.exit(options, err);
        }
    }
}
