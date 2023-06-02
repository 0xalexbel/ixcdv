#!/usr/bin/env bash
# In order to be able to use the latest versions of truffle + ganache (v5.7.0 and higher)
# we must apply a patch to the official v5.3 version of the iexec PoCo repository

# Create a git patch between:
#   - https://github.com/iExecBlockchainComputing/PoCo.git + tag v5.3.0 (hash=5138f2d2275c5e983d89609035a236697fe891fb) 
# and:
#   - https://github.com/0xalexbel/PoCo.git + branch fix-artifacts-require-truffle-v5-7-0

DIR=$(pwd)
if [[ $? != "0" ]]; then 
    echo "pwd failed."
    exit 1
fi

TMP='/tmp/ixcdv/PoCoPatch'

# v5.3 git commit hash
COMMITID='5138f2d2'
# https://github.com/0xalexbel/PoCo.git branch
BRANCH='develop'
# output patch filename (must be equal to value stored in './patch.js')
PATCHFILE="PoCo-from-${COMMITID}.patch"

if [[ -d "${TMP}" ]]; then
    echo "rm -rf ${TMP}"
    rm -rf "${TMP}"
fi

mkdir -p "${TMP}"

echo "cd ${TMP}"
cd "${TMP}"

# Clone repo
echo "git clone https://github.com/0xalexbel/PoCo.git --branch ${BRANCH}"
git clone https://github.com/0xalexbel/PoCo.git --branch ${BRANCH}
if [[ $? != "0" ]]; then 
    echo "git clone failed."
    rm -rf "${TMP}"
    exit 1
fi

# Build patch 
cd PoCo
git format-patch "${COMMITID}" --stdout > "${TMP}/${PATCHFILE}"
if [[ $? != "0" ]]; then 
    echo "git format-patch failed."
    rm -rf "${TMP}"
    exit 1
fi

if [[ -f "${DIR}/${PATCHFILE}" ]]; then
    cp "${DIR}/${PATCHFILE}" "${DIR}/${PATCHFILE}.bak"
fi

echo "cp -f ${TMP}/${PATCHFILE} ${DIR}/${PATCHFILE}"
cp -f "${TMP}/${PATCHFILE}" "${DIR}/${PATCHFILE}"

echo "rm -rf ${TMP}"
rm -rf "${TMP}"

