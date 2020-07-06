const csv = require('csvtojson');
const mysql = require('mysql');
const { parse } = require('json2csv');
const fs = require('fs');

const csvFilePath = './prices.csv';


let db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database : ""
});

let succeed = 0, 
    failed = 0,
    total = 0,
    failedProducts = [],
    promises = [];

csv()
.fromFile(csvFilePath)
.then((products) => {
    total = products.length;

    console.log(`File read successfully, replacement process started! ${total} rows to be replaced`);

    db.connect((err) => {
        if (err) throw err;
        console.log("Database connected!");

        products.forEach((product, i) => {
            const fn = async() => {
                try {
                    if (!product.sku || !product.price) {
                        failed++;

                        return;
                    }

                    let id = await getIDBySKU(product.sku);

                    if (!id) {
                        setFailedProduct(product);

                        return;
                    }

                    let productType = await getProductType(id);

                    if (productType === 'product') {
                        let childID = await getChildID(id);

                        if (!childID) {
                            setFailedProduct(product);

                            return;
                        }

                        id = childID;
                    }

                    let result = await updateProductPrice(id, product.price.replace(',', ''));

                    if(!result) {
                        setFailedProduct(product);

                        return;
                    }

                    succeed++;

                    console.log(`Product ${product.sku} updated with success!`);
                } catch(error) {
                    console.log(error);
                }
            }

            promises.push(fn());
        })

        Promise.all(promises).then(async () => {
            await clearWPCache();

            console.log(`Cleaning up WP Options cache...`);

            db.end();
            
            generateCSVFile(failedProducts);

            console.log(`###################################################\n###################################################\Successful updates ${succeed}\nFailed updates ${failed}\nTotal ${total} products`);
        })
    });
},
console.error)

async function getIDBySKU(sku) {
    return new Promise((resolve, reject) => {
        db.query(`SELECT post_id FROM wp_postmeta WHERE meta_key='_sku' AND meta_value='${sku}';`, (err, result) => {
            if (err) return reject(new Error(err));

            if(!result.length) {
                return resolve(false);
            }

            return resolve(result[0].post_id);
        })
    })
}

async function getProductType(id) {
    return new Promise((resolve, reject) => {
        db.query(`SELECT post_type FROM wp_posts WHERE ID = ${id}`, (err, result) => {
            if (err) return reject(new Error(err));

            if(!result.length) {
                return resolve(false);
            }

            return resolve(result[0].post_type);
        })
    })
}

async function getChildID(parentID) {
    return new Promise((resolve, reject) => {
        db.query(`SELECT ID FROM wp_posts WHERE post_parent = ${parentID}`, (err, result) => {
            if (err) return reject(new Error(err));

            if(!result.length || result.length > 1) {
                return resolve(false);
            }

            return resolve(result[0].ID);
        })
    })
}

async function updateProductPrice(id, price) {
    return new Promise(async (resolve, reject) => {
        if(isNaN(price)) {
            return resolve(false);
        }
       
        let updateRegularPrice = await dbQuery(`UPDATE wp_postmeta SET meta_value = ${price} WHERE post_id = ${id} AND meta_key = "_regular_price" `);

        if(!updateRegularPrice) {
            await dbQuery(`INSERT INTO wp_postmeta VALUES (NULL, ${id}, '_regular_price', '${price}')`);
        }

        let updatePrice = await dbQuery(`UPDATE wp_postmeta SET meta_value = ${price} WHERE post_id = ${id} AND meta_key = "_price"`);

        if(!updatePrice) {
            await dbQuery(`INSERT INTO wp_postmeta VALUES (NULL, ${id}, '_price', '${price}')`);
        }

        return resolve(true);
    })
}

async function dbQuery(query) {
    return new Promise((resolve, reject) => {
        db.query(query, (err, result) => {
            if (err) return reject(new Error(err));

            return resolve(!!result.affectedRows);
        })
    })
}
        
function setFailedProduct(product) {
    failed++;

    failedProducts.push({
        sku: product.sku,
        price: product.price
    })

    console.log(`Product ${product.sku} updated failed!`);
}

async function clearWPCache() {
    let query =    `DELETE
                    FROM wp_options
                    WHERE (option_name LIKE '_transient_wc_var_prices_%'
                        OR option_name LIKE '_transient_timeout_wc_var_prices_%')`;

    return new Promise((resolve, reject) => {
        db.query(query, (err, result) => {
            if (err) return reject(new Error(err));

            if(!result.length) {
                return resolve(false);
            }

            return resolve(true);
        })
    })
}


function generateCSVFile(data) {
    if(!data.length) {
        return;
    }

    const fields = ['sku', 'price'];

    const filename = `failed-results-${+new Date}.csv`;

    try {
        const csv = parse(data, { fields });

        fs.writeFile(`./results/${filename}`, csv, function(err) {
            if(err) {
                return console.log(err);
            }

            console.log(`List of failed occurrences saved at results folder\nFile: ${filename}`);
        });

    } catch (err) {
        console.error(err);
    }
}