# ixcdv - for macOS & VSCode

ixcdv (=*iexecdev*) is a macOS tool for creating, running and debugging a **local** iExec cloud computing stack for development and testing.

## Rationale

- [iExec](https://github.com/iExecBlockchainComputing) is a powerfull microservice architecture involving a set of individual components interacting with each other to provide an innovative blockchain-based cloud computing solution. 

- Each iExec microservice is open-source and published on github (https://github.com/iExecBlockchainComputing). However, it can be tricky to install and configure this whole machinery on your Mac. iExec services have been primarily developped to run on Linux systems and must be individually configured.

- In order to deeply understand the iExec stack inner mechanisms and subtleties, it is much more convenient to be able to locally install the full [iExec](https://github.com/iExecBlockchainComputing) stack and run it within your favorite IDE. By doing so, you are free to place breakpoints here and there and better figure out how the whole thing works.

- Here comes **ixcdv**, a software tool that allows you to install, run and manipulate a **local** instance of the full iExec cloud computing stack. **ixcdv** will do all the dirty work for you, so you can focus on testing your dapp and understand the inner mechanisms of the iExec platform.  

## How it works ?

- Install `ixcdv`
- Create a new folder somewhere
- Use ixcdv to **install and configure** a full iExec stack inside that folder
- start your new **local** iExec stack
- run an app Dockerfile within your new **local** iExec stack
- when you are done, stop the stack
- delete the folder

## Features in a Nutshell

- Runs on **Mac** (macOs BigSur or higher).
- Install/Run/Debug the Full **[iExec stack](https://github.com/iExecBlockchainComputing)** with any number of workers. 
    - install multiple stacks
    - configure each stack individually
- Full **VSCode** support. 
    - You can run and debug every single iExec piece of software directly withing VSCode.
- Fully **local**. 
    - **ixcdv** does not rely on any external online services (with the unique exception of Docker which has to access https://docker.io when images are built for the first time).
- Native execution. 
    - Every iExec service is running natively on your Mac, outside of any container.
- CLI.
    - **ixcdv** comes with a minimal CLI allowing you to interact & perform tests with a local iExec cloud stack. It also offers handy helpers to monitor your stack.
- Full [iExec CLI/SDK](https://github.com/iExecBlockchainComputing/iexec-sdk) support.
    - **ixcdv** also supports the official [iExec CLI](https://github.com/iExecBlockchainComputing/iexec-sdk). You can run any **iexec-sdk** command against your local testing environment. 
- Clean uninstall
    - every **ixcdv** workspace is trivial to uninstall and nothing is left behind on your Mac.

## Limitations

- Does not yet support 'tee' mode (this feature requires Intel SGX processor).
- Not tested on Linux
- Not tested on Windows

## [System Requirements](./INSTALL.md)

For detailed info about the sytem requirements please refer to [INSTALL.md](./INSTALL.md)

## Install

```sh
# download the latest version
git clone https://github.com/0xalexbel/ixcdv.git
cd ./ixcdv

# install the npm package locally 
npm install
# make it accessible globally
npm install -g .

ixcdv --version
ixcdv --help
```

## Check System Requirements

Once the **ixcdv** repo downloaded and installed, you can type the following command to check whether the system requirements are properly met or not:

```sh 
# the command will also provide you with detailed actions to execute if tools are missing.
ixcdv show sysreq
```

## Uninstall

```sh
# remove any global reference to ixcdv
npm uninstall -g ixcdv

# remove ixcdv downloaded repo folder
rm -rf ./ixcdv
```

## Quick start

```sh
# create a new empty folder to host our future ixcdv workspace
mkdir ./my-workspace

# make it the current working directory
cd ./my-workspace

# initialize a new ixcdv workspace
# a file named 'ixcdv-config.json' will be created
ixcdv init 

# install the full iExec infrastructure
# this may take a few minutes
# note that everything is strictly kept inside the 'my-workspace' folder
ixcdv install 

# once done, simply run an elementary test
# to make sure the whole stuff is properly installed and configured
ixcdv test 

# If the test passed successfully, 
# you can now try to run the official iExec hello world
# example named : 'nodejs-hello-world'
```

## How to run iExec's 'nodejs-hello-world' example

Let's stay in our playground interestingly named 'my-workspace'. From there, you can run the traditionnal hello-world example. To do so, we will use the little nodejs program provided by iExec. 

First, we must download the hello-world test app available at: https://github.com/iExecBlockchainComputing/nodejs-hello-world.

```sh
# let's install the hello world example
cd ./my-workspace

# Keep it clean and create a dedicated folder for all your apps  
mkdir ./apps

cd ./apps

# download the official test program named 'nodejs-hello-world'
git clone https://github.com/iExecBlockchainComputing/nodejs-hello-world

# Please note that the 'Dockerfile' we are looking for 
# is located in the 'cloud-computing' sub-folder.
ls -l ./nodejs-hello-world/cloud-computing
```

Once downloaded, we can run the app in our local iExec infrastructure we just deployed in the `./my-workspace` folder.

```sh
# let's go back to our top-level workspace folder
cd ./my-workspace

# Run the dapp inside our 'local' iExec stack
# Et voila!
ixcdv app run ./apps/nodejs-hello-world/cloud-computing --name nodejs-hello-world
```

Below, you can see the kind of terminal output you should get once the dapp has successfully completed.

```sh
  _   _      _ _         __        __         _     _ 
 | | | | ___| | | ___    \ \      / /__  _ __| | __| |
 | |_| |/ _ \ | |/ _ \    \ \ /\ / / _ \| '__| |/ _` |
 |  _  |  __/ | | (_) |    \ V  V / (_) | |  | | (_| |
 |_| |_|\___|_|_|\___( )    \_/\_/ \___/|_|  |_|\__,_|
                     |/                               
Hello, World
No dataset was found
```
Note: the message 'No dataset was found' is printed out because we did not provided the dapp with a dataset argument (you can do so by using the --dataset option).

## Run 'nodejs-hello-world' using the `iexec` CLI.

```sh
#!/bin/bash
# Let's go back to our ixcdv root workspace
cd ./my-workspace

# Make sure out local iExec cloud computing is running using 1 scheduler and 1 worker
ixcdv start worker --count 1 --chain 1337.standard

# Let's create a folder where we will execute all the iexec sdk commands
mkdir ./hello-using-iexec-cli

cd ./hello-using-iexec-cli

# Generate 'chain.json' + 'iexec.json' using ixcdv command
ixcdv app init ../apps/nodejs-hello-world/cloud-computing --name nodejs-hello-world --chain 1337.standard

# Now let's run the iexec sdk
# Deploy app
# By convention, wallet #2 is assigned to the app owner
iexec app deploy --keystoredir ../shared/db/ganache.1337/wallets --wallet-file wallet2.json --password whatever --chain 1337.standard

# View deployed app
iexec app show --chain 1337.standard

# Create a new default app order (appended to file 'iexec.json')
iexec order init --app --chain 1337.standard

# Take a look at the new order field in 'iexec.json' file
cat ./iexec.json

# Sign the newly created app order using the app's wallet (index=2).
# Basically, the app's owner gives anybody the right to use its app 
# X amount of time. By default, X=1000000 (limitless)
# The signed order is stored in 'orders.json'
iexec order sign --app --keystoredir ../shared/db/ganache.1337/wallets --wallet-file wallet2.json --password whatever --chain 1337.standard

# iexec created a new file called 'orders.json'
# You can view the new signed app order in it
cat ./orders.json

# Create a new default workerpool order
iexec order init --workerpool --chain 1337.standard

# Sign the newly created workerpool order using the workerpool's wallet (index=1)
# Here, the workerpool's owner gives anybody the right to use its 
# network of computers (usually refered as 'workers') only 1 single time
# By convention, wallet #1 is assigned to the workerpool owner (workerpool == the core scheduler)
iexec order sign --workerpool --keystoredir ../shared/db/ganache.1337/wallets --wallet-file wallet1.json --password whatever --chain 1337.standard

# setup requester storage token for provider "ipfs"
# By convention, wallet #4 is assigned to a 'symbolic' user 
iexec storage init --keystoredir ../shared/db/ganache.1337/wallets --wallet-file wallet4.json --password whatever --chain 1337.standard --force-update

# At this point, we have:
# 1. an app owner who granted anybody the right to run its app (wallet #2)
# 2. a workpool owner who granted anybody the right to run anything (wallet #1)
#    on its computer network. 
# Here comes a third user refered to as the 'requester'
# and identified by wallet #4 (index=4).
# Note: wallet #3 is assigned to a 'dataset' owner (not in the current example)
iexec order fill --keystoredir ../shared/db/ganache.1337/wallets --wallet-file wallet4.json --password whatever --chain 1337.standard --force
```

## [Debug inside VSCode](./VSCODE.md)

Checkout [VSCODE.md](./VSCODE.md) for a detailed tutorial explaining how to debug the iExec stack inside VSCode.

## Take a look at all the running services

To inspect the running processes, type:

```sh
ixcdv pid
```

## Stop everything

To stop all running `iexec` services, type:

```sh
ixcdv stop all
```

## Kill everything

In some situations (like multiple ixcdv workspaces) calling the stop command may not work as expected. To make sure all the ixcdv services are stopped, you can use the kill command:

```sh
ixcdv kill all
```

## Uninstall an ixcdv workspace 

To uninstall any ixcdv workspace do as follow:

```sh
# Go back to the workspace folder you want to uninstall
cd ./my-workspace

ixcdv uninstall 

# Get rid of the workspace folder
rm -rf ./my-workspace

# That's it!
```
## Wallets

Each time you install a new iExec dev stack, **ixcdv** automatically generates a set of predefined wallets. 
- `wallet0.json` : The admin user (owner of all iExec hub contracts deployed on the test chain) 
- `wallet1.json` : The workerpool user, owner of the `core` scheduler. The workerpool is in charge of dispatching the computing requests among the various `workers`.
- `wallet2.json` : The app owner. By default, all apps are deployed using `wallet2.json`.
- `wallet3.json` : The dataset owner. By default, all datasets are deployed using `wallet3.json`.
- `wallet4.json` : The requester (or request owner). By default, all computing requests are ordered using `wallet4.json`.
- `wallet5.json` and abover are reserved to the `workers`. Each worker uses one given wallet (ex: worker #0 uses `wallet.5.json`, worker#1 uses `wallet6.json` etc.)

By default, all the wallets have the same password : `whatever`

## What does 'ixcdv' stand for ?

iexecdev - e = ixcvd

## About iExec

- gitHub repository : https://github.com/iExecBlockchainComputing
- website : https://iex.ec

## What are the iExec services managed by ixcdv ?

- iexec-core : (https://github.com/iExecBlockchainComputing/iexec-core)
- iexec-worker : (https://github.com/iExecBlockchainComputing/iexec-worker)
- iexec-sms : (https://github.com/iExecBlockchainComputing/iexec-sms)
- iexec-result-proxy : (https://github.com/iExecBlockchainComputing/iexec-result-proxy)
- iexec-blockchain-adpater-api : (https://github.com/iExecBlockchainComputing/iexec-blockchain-adapter-api)
- iexec-market-api : (https://github.com/iExecBlockchainComputing/iexec-market-api)
- iexec-sdk : (https://github.com/iExecBlockchainComputing/iexec-sdk)



