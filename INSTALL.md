# Install 

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

# System Requirements

- [vscode](#vscode)
- [java](#java)
- [git](#git)
- [ipfs](#ipfs)
- [ganache](#ganache)
- [truffle](#truffle)
- [docker](#docker)
- [gradle](#gradle)
- [mongo](#mongo)
- [redis](#redis)

## vscode 

Minimum vscode config:
- vscode (https://code.visualstudio.com/download)
- [Microsoft Extension Pack for Java](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-pack) (Required)
- For more info, see vscode java tools page : https://code.visualstudio.com/docs/languages/java


## java

- Eclipse Temurin : https://adoptium.net/en-GB/temurin/releases/
- Operating System : macOS
- Architecture : x64(Intel)/aarch64(Apple M1/M2)
- Version : 17

## git

```sh
brew install git
```

homepage: https://git-scm.com/

## ipfs

**IMPORTANT NOTE**: _ixcdv_ uses ipfs as local node. Never connects to the public ipfs network

install page : https://docs.ipfs.tech/install/command-line/#install-official-binary-distributions 
download page : https://dist.ipfs.tech/#kubo

## ganache

```sh
npm install -g ganache
```

homepage: https://trufflesuite.com

## truffle

```sh
npm install -g truffle
```

homepage: https://trufflesuite.com

## Docker for Mac

download page : https://www.docker.com/products/docker-desktop/

## Gradle

```sh
brew install gradle
```

homepage : https://gradle.org/

## Mongo

```sh
brew tap mongodb/brew
brew update
brew install mongodb-community@6.0
```

download page : https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-os-x/

## Redis

```sh
brew install redis
```

download page : https://redis.io/docs/getting-started/installation/install-redis-on-mac-os/
