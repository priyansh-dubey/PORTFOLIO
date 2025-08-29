// .dependency-cruiser.cjs
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  options: {
    tsConfig: {
      fileName: "tsconfig.json"
    },
    exclude: {
      path: [
        "node_modules",
        "dist",
        "build",
        "coverage",
        "\\.github",
        "\\.next",
        "out"
      ]
    },
    doNotFollow: {
      path: ["node_modules"]
    },
    outputType: "json",
    validate: false
  }
};
