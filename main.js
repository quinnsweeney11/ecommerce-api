const paymentHandler = require("./payment");
require("dotenv").config();
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const saltRounds = 10;
const app = express();
const port = 3000;
const { Client } = require("pg");

function generateAccessToken(accountId) {
  return jwt.sign(accountId, process.env.TOKEN_SECRET, { expiresIn: "1800s" });
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token == null) return res.sendStatus(401);
  let output;
  jwt.verify(token, process.env.TOKEN_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);

    output = user;
  });
  return output;
}

async function main() {
  const client = new Client({
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    port: process.env.PGPORT,
  });
  await client.connect().then(() => console.log("connected to database"));
  app.use(express.json());
  app.use(
    express.urlencoded({
      extended: true,
    })
  );
  app.get("/", (req, res) => {
    res.send("api home");
  });

  app.get("/login", async (req, res) => {
    const plainTextPassword = req.body.password;
    const hash = (
      await client.query(`SELECT * FROM users WHERE email='${req.body.email}'`)
    ).rows[0];
    if (hash === undefined) {
      res.status(401);
      res.json({
        success: false,
        message: "could not find an account associated with that email",
      });
    } else {
      bcrypt.compare(plainTextPassword, hash.password, function (err, result) {
        if (result === true) {
          const token = generateAccessToken({ user_id: hash.user_id });
          res.status(200);
          res.json({
            success: true,
            message: "login success",
            accessToken: token,
          });
        } else {
          res.status(401);
          res.json({
            success: false,
            message: "incorrect password",
          });
        }
      });
    }
  });

  app.post("/register", async (req, res) => {
    const duplicate = await client.query(
      `SELECT * FROM users WHERE email='${req.body.email}'`
    );
    if (duplicate.rows.length > 0) {
      res.status(409);
      res.json({
        success: false,
        message: "duplicate email",
      });
    } else {
      bcrypt.hash(req.body.password, saltRounds, async function (err, hash) {
        await client.query(
          `INSERT INTO users (email, password) VALUES ('${req.body.email}', '${hash}');`
        );
        res.json({
          success: true,
          message: "signup success",
        });
      });
    }
  });

  app.get("/products", async (req, res) => {
    if (req.query.category === undefined) {
      const output = await client.query("SELECT * FROM products");
      res.json(output.rows);
    } else {
      const output = await client.query(
        `SELECT * FROM products WHERE category='${req.query.category}'`
      );
      res.json(output.rows);
    }
  });

  app.get("/products/:id", async (req, res) => {
    const output = await client.query(
      `SELECT * FROM products WHERE product_id=${req.params.id}`
    );
    res.json(output.rows);
  });

  app.post("/products", async (req, res, next) => {
    const user = authenticateToken(req, res, next);
    const userAdmin = await client.query(
      `SELECT * FROM users WHERE user_id=${user.user_id}`
    );
    if (userAdmin.rows[0].is_admin === true) {
      await client.query(
        `INSERT INTO products (name, description, category, stock, variants) VALUES ('${req.body.name}', '${req.body.description}', '${req.body.category}', ${req.body.stock}, ARRAY ${req.body.variants});`
      );
      res.status(201);
      res.json({
        success: true,
        message: "item added successfully",
      });
    } else {
      res.status(401);
      res.json({
        success: false,
        message:
          "you need an account with administrator priveleges to access this resource",
      });
    }
  });

  app.get("/users", async (req, res, next) => {
    const user = authenticateToken(req, res, next);
    const userAdmin = await client.query(
      `SELECT * FROM users WHERE user_id=${user.user_id}`
    );
    if (userAdmin.rows[0].is_admin === true) {
      const users = await client.query(
        `SELECT user_id, email, is_admin FROM users;`
      );
      res.status(201);
      res.json(users.rows);
    } else {
      res.status(401);
      res.json({
        success: false,
        message:
          "you need an account with administrator priveleges to access this resource",
      });
    }
  });

  app.get("/users/:id", async (req, res, next) => {
    const user = authenticateToken(req, res, next);
    const userAdmin = await client.query(
      `SELECT * FROM users WHERE user_id=${user.user_id}`
    );
    if (userAdmin.rows[0].is_admin === true) {
      const users = await client.query(
        `SELECT user_id, email, is_admin FROM users WHERE user_id=${req.params.id};`
      );
      res.status(201);
      res.json(users.rows);
    } else {
      res.status(401);
      res.json({
        success: false,
        message:
          "you need an account with administrator priveleges to access this resource",
      });
    }
  });

  app.post("/cart", async (req, res, next) => {
    const user = authenticateToken(req, res, next);
    const existingCart = await client.query(
      `SELECT * FROM carts WHERE user_id=${user.user_id}`
    );
    if (existingCart.rows.length > 0) {
      const existingCartId = (
        await client.query(`SELECT * FROM carts WHERE user_id=${user.user_id}`)
      ).rows[0].cart_id;
      await client.query(
        `INSERT INTO cart_items (cart_id, product_id, variant, quantity) VALUES (${existingCartId}, ${req.body.productId}, '${req.body.variant}', ${req.body.quantity})`
      );
      res.json({
        success: true,
        message: `user ${user.user_id} already has cart ${existingCartId}`,
        cartId: existingCartId,
      });
    } else {
      const newCartId = (
        await client.query(
          `INSERT INTO carts (user_id) VALUES (${user.user_id}) RETURNING cart_id`
        )
      ).rows[0].cart_id;
      await client.query(
        `INSERT INTO cart_items (cart_id, product_id, variant, quantity) VALUES (${newCartId}, ${req.body.productId}, '${req.body.variant}', ${req.body.quantity})`
      );
      res.json({
        success: true,
        message: `cart ${newCartId} created for user with id ${user.user_id}`,
        cartId: newCartId,
      });
    }
  });

  app.get("/cart", async (req, res, next) => {
    const user = authenticateToken(req, res, next);
    const existingCart = await client.query(
      `SELECT * FROM carts WHERE user_id=${user.user_id}`
    );
    if (existingCart.rows.length > 0) {
      const cartItems = (
        await client.query(
          `SELECT * FROM cart_items WHERE cart_id=${existingCart.rows[0].cart_id};`
        )
      ).rows;
      res.json({
        success: true,
        message: "cart found",
        cartInfo: existingCart.rows[0],
        cartItems,
      });
    } else {
      res.json({
        success: false,
        message: "user does not have an existing cart",
      });
    }
  });

  app.post("/checkout/:id", async (req, res, next) => {
    const user = authenticateToken(req, res, next);
    const existingCart = (
      await client.query(
        `SELECT * FROM carts WHERE user_id=${user.user_id} AND cart_id=${req.params.id}`
      )
    ).rows;
    if (existingCart.length > 0) {
      const paymentSuccess = await paymentHandler();
      if (paymentSuccess) {
        const transactionItems = (
          await client.query(
            `SELECT * FROM cart_items WHERE cart_id=${req.params.id}`
          )
        ).rows;
        console.log(transactionItems);
        const transactionId = (
          await client.query(
            `INSERT INTO transactions (user_id) VALUES (${user.user_id}) RETURNING transaction_id`
          )
        ).rows[0];
        console.log(transactionId);
        transactionItems.forEach(async (item) => {
          console.log(
            `INSERT INTO transaction_items (transaction_id, product_id, variant, quantity) VALUES (${transactionId.transaction_id}, ${item.product_id}, '${item.variant}', ${item.quantity})`
          );
          await client.query(
            `INSERT INTO transaction_items (transaction_id, product_id, variant, quantity) VALUES (${transactionId.transaction_id}, ${item.product_id}, '${item.variant}', ${item.quantity})`
          );
        });
        await client.query(`DELETE FROM carts WHERE cart_id=${req.params.id}`);
        await client.query(
          `DELETE FROM cart_items WHERE cart_id=${req.params.id}`
        );
        res.json({
          success: true,
          message: "payment and checkout success",
          transactionId: transactionId.transactionId,
        });
      }
    } else {
      res.json({
        success: false,
        message: "no active cart",
      });
    }
  });

  app.get("/transactions", async (req, res, next) => {
    const user = authenticateToken(req, res, next);
    const userAdmin = await client.query(
      `SELECT * FROM users WHERE user_id=${user.user_id}`
    );
    if (userAdmin.rows[0].is_admin === true) {
      //show ALL orderes
      const transactions = (await client.query(`SELECT * FROM transactions`))
        .rows;
      const transactionItems = (
        await client.query(`SELECT * FROM transaction_items`)
      ).rows;
      const output = {};
      transactions.forEach((transaction) => {
        const result = {
          items: transactionItems.filter(
            (e) => e.transaction_id === transaction.transaction_id
          ),
          timestamp: transaction.date,
          userId: transaction.user_id,
        };
        output[transaction.transaction_id] = { ...result };
      });
      res.json({
        success: true,
        message: "found transactions 😎",
        transactions: output,
      });
    } else {
      res.json({
        success: false,
        message:
          "you do not have permission to view this endpoint. please request /mytransactions to view user specific transaction history",
      });
    }
  });

  app.get("/mytransactions", async (req, res, next) => {
    const user = authenticateToken(req, res, next);
    const transactions = (
      await client.query(
        `SELECT * FROM transactions WHERE user_id=${user.user_id}`
      )
    ).rows;
    const transactionItems = (
      await client.query(`SELECT * FROM transaction_items`)
    ).rows;
    const output = {};
    transactions.forEach((transaction) => {
      const result = {
        items: transactionItems.filter(
          (e) => e.transaction_id === transaction.transaction_id
        ),
        timestamp: transaction.date,
        userId: transaction.user_id,
      };
      output[transaction.transaction_id] = { ...result };
    });
    res.json({
      success: true,
      message: "found transactions 😎",
      transactions: output,
    });
  });

  app.get("/transactions/:id", async (req, res, next) => {
    const user = authenticateToken(req, res, next);
    const userAdmin = await client.query(
      `SELECT * FROM users WHERE user_id=${user.user_id}`
    );
    if (userAdmin.rows[0].is_admin === true) {
      const transaction = (
        await client.query(
          `SELECT * FROM transactions WHERE transaction_id=${req.params.id}`
        )
      ).rows[0];
      const transactionItems = (
        await client.query(
          `SELECT * FROM transaction_items WHERE transaction_id=${req.params.id}`
        )
      ).rows[0];
      if (transaction !== undefined) {
        const output = {};
        const result = {
          items: transactionItems,
          timestamp: transaction.date,
          userId: transaction.user_id,
        };
        output[transaction.transaction_id] = { ...result };

        res.json({
          success: true,
          message: "found transaction 😎",
          transaction: output,
        });
      }
    }
  });

  app.listen(port, () => {
    console.log(`👂 on port ${port}`);
  });
}

main();
