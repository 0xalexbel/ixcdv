export const PORT_RANGE = {
    shared: {
        // max num of ganache : 10
        ganache: { from: 8545, to: 8554 },
        // max num of ipfs : 1
        ipfs: { 
            api: { from: 5002, to: 5002 }, 
            gateway: { from: 13900, to: 13900 } 
        },
        // max num of docker : 1
        docker: { from: 5008, to: 5008 },
        mongo: { from: 13500, to: 13599 },
        redis: { from: 13600, to: 13699 },
        // max num of markets : 10
        market: { 
            api: { from: 3000, to: 3009 },
            mongo: { from: 27020, to: 27029 },
            redis: { from: 27030, to: 27039 }
        },
    },
    chains: {
        // port + 1 is reserved for service management (Optional)
        sms: { from: 13300, to:13399, size: 2 },
        // port + 1 is reserved for service management (Optional)
        // port + 2 is reserved for service mongo db
        resultproxy: { from: 13200, to:13299, size: 3 },
        // port + 1 is reserved for service management (Optional)
        // port + 2 is reserved for service mongo db
        blockchainadapter: { from: 13400, to:13499, size: 3 },
        // port + 1 is reserved for service management (Optional)
        // port + 2 is reserved for service mongo db
        core: { from: 13000, to: 13099, size: 3 },
    },
    workers: { from: 13100, to: 13199, size: 1 }
};