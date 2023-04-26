import { Cmd } from "../Cmd.js";
import { Inventory } from "../../services/Inventory.js";

export default class InitCmd extends Cmd {

    static cmdname() { return 'init'; }

    /**
     * @param {string} cliDir 
     * @param {string | undefined} directory 
     * @param {*} options 
     */
    async cliExec(cliDir, directory, options) {
        try {
            const inventory = await Inventory.newDefault(directory, options);
            await inventory.saveConfigFile({ directory, overrideExistingFile: options.force });
        } catch(err) {
            this.exit(options, err);
        }
    }
}
