# Running the iExec stack from VSCode 

## Install VSCode minimum configuration   
- vscode (https://code.visualstudio.com/download)
- [Microsoft Extension Pack for Java](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-pack) (Required)
- For more info, see vscode java tools page : https://code.visualstudio.com/docs/languages/java


## Install your local iExec stack  

```sh
# Let's create some folder somewhere
mkdir ./my-workspace
cd ./my-workspace

# generate the ixcdv-config.json file
ixcdv init

# download, build, configure the whole iExec stack locally
# this may take a few minutes
ixcdv install
```

## Generate the `.code-workspace` files 

```sh
# For ease of understanding, we can stay inside the stack 
# top-level folder 'my-workspace'.
cd ./my-workspace

# Let's create a 'vscode' folder
mkdir ./vscode
cd ./vscode

# ask ixcdv to generate the `code-workspace` files
# corresponding to your previously installed iExec stack 
ixcdv vscode install
```

## Run the 'core' and 'worker' services inside the VSCode debugger

- Launch vscode
- Choose: **File > Open Workspace from File...**
- Select the following ready-made .code-workspace file : `./my-workspace/vscode/1337.standard/all.1337.standard.code-workspace`
- Wait a few minutes (dependending on your machine) until vscode has fully configured all the java projects. This can take quite some time...
- Show the **Run and Debug** panel
- From the top **RUN AND DEBUG** dropdown menu, select _`"Launch iexec-core-<version>"`_
- Choose: **Run > Start Debugging**
- Wait until the `iexec-core scheduler` is fully running (watch the logs).
- Now let's launch one `iexec-worker` instance
- From the top **RUN AND DEBUG** dropdown menu, select _`"Launch iexec-worker-<version> #0"`_
- Choose: **Run > Start Debugging**

## Execute a test

Now that the debugger is up and running, we can launch the actual test and watch the whole stuff in action.

- Choose: **View > Command Palette...**
- Select: **Tasks: Run Task...**
- Choose task named: _**ixcdv test**_
- At this point, you should be able to watch the various execution steps between the 'core' and 'worker' services.

