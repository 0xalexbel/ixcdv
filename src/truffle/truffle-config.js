export default
{
    networks:
    {
        development:
        {
            host: "[NETWORKS_DEVELOPMENT_HOST]",
            port: 8545,
            //from: "0x[contract address]",
            network_id: "*",
            gasPrice: "8000000000", // 8 Gwei
            disableConfirmationListener: true,
        }
    },
    compilers: {
        solc: {
            version: "0.6.12",
            settings: {
                optimizer: {
                    enabled: true,
                    runs: 200
                }
            }
        }
    },
    mocha:
    {
        enableTimeouts: false
    }
};
