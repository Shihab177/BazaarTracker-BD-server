const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const moment = require('moment');
const app =express()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
var admin = require("firebase-admin");
const port = process.env.PORT || 7000
dotenv.config()

app.use(cors())
app.use(express.json())

const decodedKey = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')

var serviceAccount = JSON.parse(decodedKey);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});



const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.3svvryn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // await client.connect();

     const usersCollection = client.db('BazaarTracker-BD-DB').collection('users')
     const productCollection = client.db('BazaarTracker-BD-DB').collection('products')
     const advertisementCollection = client.db("BazaarTracker-BD-DB").collection("advertisements");
      const reviewsCollection =client.db("BazaarTracker-BD-DB").collection("reviews");
      const paymentsCollection =client.db("BazaarTracker-BD-DB").collection("payments");
      const watchlistCollection =client.db("BazaarTracker-BD-DB").collection("watchlist");
      const ordersCollection =client.db("BazaarTracker-BD-DB").collection("orders");

       // custom middlewares
        const verifyFBToken = async (req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).send({ message: 'unauthorized access' })
            }
            const token = authHeader.split(' ')[1];
            if (!token) {
                return res.status(401).send({ message: 'unauthorized access' })
            }

            // verify the token
            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.decoded = decoded;
                next();
            }
            catch (error) {
                return res.status(403).send({ message: 'forbidden access' })
            }
        }

             const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
              console.log(email)
            const query = { email }
            const user = await usersCollection.findOne(query);
            console.log(user)
            if (!user || user.role !== 'admin') {
                return res.status(401).send({ message: 'forbidden access' })
            }
            next();
        }
          const verifyVendor = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            if (!user || user.role !== 'vendor') {
                return res.status(401).send({ message: 'forbidden access' })
            }
            next();
        }

      //home page product section api
      app.get("/products-public", async (req, res) => {
  const limit = parseInt(req.query.limit) || 6;
console.log('hello')
  // const today = new Date();
  // const threeDaysAgo = new Date();
  // threeDaysAgo.setDate(today.getDate() - 3);
console.log(limit)
  const query = {
    status: "approved",
    // date: {
    //   $gte: moment(threeDaysAgo).format("YYYY-MM-DD"),
    //   $lte: moment(today).format("YYYY-MM-DD"),
    // },
  };

  const products = await productCollection
    .find(query)
    .sort({ date: -1 })
    .limit(limit)
    .toArray();

  res.send(products);
});
 //get home page advertisement 

 app.get('/approved-ads', async (req, res) => {
  try {
    const result = await advertisementCollection
      .find({ status: 'approved' })
       .limit(6)
      .sort({ createdAt: -1 }) 
      .toArray();

    res.send(result);
  } catch (error) {
    console.error('Failed to fetch approved ads:', error);
    res.status(500).send({ message: 'Internal server error' });
  }
});

     //all products page api/ public route
     app.get('/all-products-public', async (req, res) => {
  const { sort, startDate, endDate } = req.query;

  const query = { status: "approved" };

  // Date range filtering
  if (startDate && endDate) {
    query.date = {
      $gte: startDate,
      $lte: endDate,
    };
  }

  
   let sortOption = {};
  if (sort === "low-to-high") sortOption.pricePerUnit = 1;
  else if (sort === "high-to-low") sortOption.pricePerUnit = -1;
  else sortOption.date = -1; 

  const products = await productCollection.find(query).sort(sortOption).toArray();
  res.send(products);
});
    // products get by id
    app.get('/products/:id',verifyFBToken, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await productCollection.findOne({ _id: new ObjectId(id) });
    if (!result) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    console.log(result)
    res.status(200).send(result);

  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}); 
       // GET /products/:id/reviews
  app.get("/products/:id/reviews",verifyFBToken, async (req, res) => {
    const productId = req.params.id;

    try {
      const reviews = await reviewsCollection
        .find({ productId: new ObjectId(productId) })
        .sort({ createdAt: -1 })
        .toArray();
      res.json(reviews);
    } catch (err) {
      res.status(500).json({ error: "Failed to load reviews" });
    }
  });

  // @route GET /products/:id/price-trend
app.get("/products/:id/price-trend",verifyFBToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { date: selectedDate } = req.query;

    if (!selectedDate) {
      return res.status(400).json({ message: "Date query parameter is required" });
    }

    const product = await productCollection.findOne({ _id: new ObjectId(id) });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Assuming product.prices is an array of { date: "YYYY-MM-DD", price: number }
    const previousPriceEntry = product.prices.find(p => p.date === selectedDate);

    if (!previousPriceEntry) {
      return res.status(404).json({ message: "No price data found for selected date" });
    }

    const currentPrice = product.pricePerUnit;
    const previousPrice = previousPriceEntry.price;
    const difference = currentPrice - previousPrice;

    res.json({
      name: product.itemName,
      currentPrice,
      previousPrice,
      difference,
    });
  } catch (error) {
    console.error("Error fetching price trend:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

         app.post("/products/:id/reviews",verifyFBToken, async (req, res) => {
  const { rating, comment, userName, userEmail } = req.body;

  const review = {
    productId: new ObjectId(req.params.id),
    rating,
    comment,
    userName,                //up
    userEmail,
    createdAt: new Date(),
  };

  const result = await reviewsCollection.insertOne(review);
  res.send(result);
});

     //user 
      app.get('/users/:email/role',verifyFBToken, async (req, res) => {
            try {
                const email = req.params.email;

                if (!email) {
                    return res.status(400).send({ message: 'Email is required' });
                }

                const user = await usersCollection.findOne({ email });

                if (!user) {
                    return res.status(404).send({ message: 'User not found' });
                }

                res.send({ role: user.role || 'user' });
            } catch (error) {
                console.error('Error getting user role:', error);
                res.status(500).send({ message: 'Failed to get role' });
            }
        });

     app.post('/users',async (req,res)=>{
       try{
         const email =req.body.email
         const userExists = await usersCollection.findOne({email})
          if(userExists){
                return res.status(200).send({message:"user already exist"})
            }
            const user = req.body 
            const result = await usersCollection.insertOne(user)
            res.send(result)
       }
       catch (error){
          res.status(500).json({ error: error.message });
       }
     })
  

     //vendor api
     //get vendor product by email
     app.get('/products',verifyFBToken,verifyVendor, async (req, res) => {
  try {
    const vendorEmail = req.query.email;
    if (!vendorEmail) {
      return res.status(400).json({ success: false, message: 'Vendor email is required' });
    }
    if (req.decoded.email !== vendorEmail){
       return res.status(403).json({ message: 'unauthorize access' });
    }
    

    const products = await productCollection.find({ vendorEmail }).sort({ _id: -1 }).toArray();
    res.status(200).json(products);
  } catch (error) {
    console.error('Error fetching vendor products:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});
  
//vendor product get by id
app.get('/product/:id',verifyFBToken,verifyVendor, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await productCollection.findOne({ _id: new ObjectId(id) });
    if (!result) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
     if (req.decoded.email !== result.vendorEmail){
       return res.status(403).json({ message: 'unauthorize access' });
    }
    res.status(200).send(result);

  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}); 

     //add vendor product 
     app.post('/add-product',verifyFBToken,verifyVendor, async (req, res) => {
  try {
    const product = req.body;
    const result = await productCollection.insertOne(product);

    res.status(201).send(result);
  } catch (error) {
    
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});

//vendor product update 
app.patch('/product/:id',verifyFBToken,verifyVendor, async (req, res) => {
  try {
    const id = req.params.id;
    const updatedData = req.body;
    const product = await productCollection.findOne( { _id: new ObjectId(id) });

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (req.decoded.email !== product.vendorEmail) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }
  const result = await productCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData }
    );
     
    if (result.modifiedCount > 0) {
      res.status(200).json({
        success: true,
        message: 'Product updated successfully!',
        modifiedCount: result.modifiedCount
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'No product was modified.'
      });
    }

  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});
// DELETE /product/:id
app.delete('/product/:id',verifyFBToken,verifyVendor, async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
     const product = await productCollection.findOne(query);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    
    if (req.decoded.email !== product.vendorEmail) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }
    const result = await productCollection.deleteOne(query);
   
    if (result.deletedCount > 0) {
      res.status(200).json({ success: true, message: "Product deleted successfully" });
    } else {
      res.status(404).json({ success: false, message: "Product not found" });
    }
  } catch (error) {
     res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});
//vendor advertisement
app.get('/advertisements',verifyFBToken,verifyVendor, async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) {
      return res.status(400).json({ success: false, message: "Email query parameter is required." });
    }
     if (req.decoded.email !== email){
       return res.status(403).json({ message: 'unauthorize access' });
    }
    const ads = await advertisementCollection
      .find({ vendorEmail: email })
      .sort({ createdAt: -1 }) 
      .toArray();
   
    res.status(200).json(ads);
  } catch (error) {
    console.error('Error fetching advertisements:', error);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
});

app.post("/add-advertisement",verifyFBToken,verifyVendor, async (req, res) => {
  try {
    const adData = req.body;
    adData.createdAt = new Date();
   console.log(adData)
    const result = await advertisementCollection.insertOne(adData);

    if (result.insertedId) {
      res.status(201).json({
        success: true,
        message: "Advertisement added successfully!",
        insertedId: result.insertedId,
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to insert advertisement.",
      });
    }
  } catch (error) {
    console.error("Error adding advertisement:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});
//ads update
app.patch('/advertisement/:id',verifyFBToken,verifyVendor, async (req, res) => {
  try {
    const id = req.params.id;
    const updatedData = req.body;
    updatedData.updatedAt = new Date()
     const ads = await advertisementCollection.findOne( { _id: new ObjectId(id) })
     if (!ads) {
      return res.status(404).json({ message: 'Advertisement not found' });
    }
     if (req.decoded.email !== ads.vendorEmail) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }
    const result = await advertisementCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData }
    );
     
    if (result.modifiedCount > 0) {
      res.status(200).json({
        success: true,
        message: 'Advertisement updated successfully!',
         modifiedCount: result.modifiedCount
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'No advertisement was modified.',
      });
    }
  } catch (error) {
    console.error('Error updating advertisement:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

app.delete('/advertisement/:id',verifyFBToken,verifyVendor, async (req, res) => {
  try {
    const id = req.params.id;
    const ad = await advertisementCollection.findOne({ _id: new ObjectId(id) });
    if (!ad) {
      return res.status(404).json({ message: 'Advertisement not found' });
    }

    
    if (req.decoded.email !== ad.vendorEmail) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }
    const result = await advertisementCollection.deleteOne({ _id: new ObjectId(id) });
    
    if (result.deletedCount > 0) {
      res.status(200).json({
        success: true,
        message: 'Advertisement deleted successfully',
         deletedCount: result.deletedCount
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Advertisement not found',
      });
    }
  } catch (error) {
    console.error('Error deleting advertisement:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

//admin dashboard route
// GET /api/users?search=abc
app.get("/users",verifyFBToken,verifyAdmin, async (req, res) => {
  try {
    const search = req.query.search;

    let query = {
      role: { $ne: "admin" }, 
    };

    if (search) {
      query.$and = [
        {
          $or: [
            { name: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
          ],
        },
      ];
    }

    const users = await usersCollection.find(query).sort({ _id: -1 }).toArray();

    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ message: "Server error fetching users." });
  }
});
//admin product get by id
app.get('/admin-product/:id',verifyFBToken,verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await productCollection.findOne({ _id: new ObjectId(id) });
    if (!result) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.status(200).send(result);

  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}); 
//product update
app.patch('/admin-product/:id',verifyFBToken,verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const updatedData = req.body;
  const result = await productCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData }
    );

    if (result.modifiedCount > 0) {
      res.status(200).json({
        success: true,
        message: 'Product updated successfully!',
        modifiedCount: result.modifiedCount
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'No product was modified.'
      });
    }

  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});
// DELETE /product/:id
app.delete('/admin-product/:id',verifyFBToken,verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };

    const result = await productCollection.deleteOne(query);
    
    if (result.deletedCount > 0) {
      res.status(200).json({ success: true, message: "Product deleted successfully" });
    } else {
      res.status(404).json({ success: false, message: "Product not found" });
    }
  } catch (error) {
     res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// GET all orders - only accessible by admin
app.get('/orders',verifyFBToken,verifyAdmin, async (req, res) => {
  const orders = await ordersCollection.find().sort({ paidAt: -1 }).toArray();
  res.send(orders);
});
//role update
app.patch("/users/:id/role",verifyFBToken,verifyAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({ message: "Role is required" });
    }

    const result = await usersCollection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { role: role } }
    );

    if (result.modifiedCount > 0) {
      res.status(200).json({ message: "User role updated successfully" });
    } else {
      res.status(404).json({ message: "User not found or role unchanged" });
    }
  } catch (error) {
    console.error("Error updating role:", error);
    res.status(500).json({ message: "Server error updating user role" });
  }
});
//all products gate
app.get("/all-products",verifyFBToken,verifyAdmin, async (req, res) => {
  try {
    const products = await productCollection.find().sort({ _id: -1 }).toArray();
    res.status(200).json(products);
  } catch (error) {
    console.error("Failed to fetch products:", error);
    res.status(500).json({ message: "Server error fetching products." });
  }
});
//all ads gets by admin dashboard
app.get('/advertisements-admin',verifyFBToken,verifyAdmin, async (req, res) => {
  try {
    const ads = await advertisementCollection
      .find()
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json(ads);
  } catch (error) {
    console.error('Error fetching advertisements:', error);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
});

// approve or reject product status with optional feedback
app.patch('/products/:id/status',verifyFBToken,verifyAdmin, async (req, res) => {
  const productId = req.params.id;
  const { status, feedback } = req.body;

  try {
    const result = await productCollection
      .updateOne(
        { _id: new ObjectId(productId) },
        {
          $set: {
            status,
            ...(feedback && { feedback }), 
          },
        }
      );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ message: "Product not found or already updated" });
    }

    res.status(200).json({ message: `Product ${status} successfully` });
  } catch (error) {
    console.error("Error updating product status:", error);
    res.status(500).json({ message: "Server error" });
  }
});
//ads status update
app.patch('/ads/status/:id',verifyFBToken,verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required.' });
    }

    const result = await advertisementCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: status } }
    );

    if (result.modifiedCount > 0) {
      res.status(200).json({ success: true, modifiedCount: result.modifiedCount });
    } else {
      res.status(404).json({ success: false, message: 'Advertisement not found or status unchanged.' });
    }
  } catch (error) {
    console.error('Error updating advertisement status:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});
app.delete('/admin-advertisement/:id',verifyFBToken,verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await advertisementCollection.deleteOne({ _id: new ObjectId(id) });
    
    if (result.deletedCount > 0) {
      res.status(200).json({
        success: true,
        message: 'Advertisement deleted successfully',
         deletedCount: result.deletedCount
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Advertisement not found',
      });
    }
  } catch (error) {
    console.error('Error deleting advertisement:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});




//payment api 

 //payment products get by id
    app.get('/payment-products/:id',verifyFBToken, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await productCollection.findOne({ _id: new ObjectId(id) });
    if (!result) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.status(200).send(result);

  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}); 

 app.get('/payments',verifyFBToken, async(req, res) => {
            try {
                const userEmail = req.query.email;

                if(req.decoded.email !== userEmail){
                    return res.status(403).send({message:"forbidden access"})
                }

                const query = userEmail ? { email: userEmail } : {};
                const options = { sort: { paid_at: -1 } }; // Latest first

                const payments = await paymentsCollection.find(query, options).toArray();
                res.send(payments);
            } catch (error) {
                console.error('Error fetching payment history:', error);
                res.status(500).send({ message: 'Failed to get payments' });
            }
        });
 app.post('/create-payment-intent',verifyFBToken, async (req, res) => {
            const amountInCents = req.body.amountInCents
            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amountInCents, // Amount in cents
                    currency: 'usd',
                    payment_method_types: ['card'],
                });

                res.json({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

         // POST: Record payment 
        app.post('/payments',verifyFBToken, async (req, res) => {
            try {
                const { productId, email, amount,name, paymentMethod, transactionId } = req.body;

               const product = await productCollection.findOne({_id: new ObjectId(productId)})
               if(product){
                const orderInfo = {
                  productId: product._id,
                 productName :product.itemName,
                 marketName : product.marketName,
                pricePerUnit :product.pricePerUnit,
                userEmail :email,
                userName: name,
                transactionId : transactionId,
                 amount : amount,
                 paidAt : new Date()
                }

                const result = await ordersCollection.insertOne(orderInfo)
               }

                // 2. Insert payment record
                const paymentDoc = {
                    productId,
                    email,
                    name,
                    amount,
                    paymentMethod,
                    transactionId,
                    paid_at_string: new Date().toISOString(),
                    paid_at: new Date(),
                };

                const paymentResult = await paymentsCollection.insertOne(paymentDoc);

                res.status(201).send({
                    message: 'Payment recorded and product marked as paid',
                    insertedId: paymentResult.insertedId,
                });

            } catch (error) {
                console.error('Payment processing failed:', error);
                res.status(500).send({ message: 'Failed to record payment' });
            }
        });


   //user dashboard api 
    ///watchlist api 

    app.post('/watchlist',verifyFBToken, async (req, res) => {
  const watchInfo  = req.body;
  watchInfo.addedAt = new Date()
 
  const exists = await watchlistCollection.findOne({
    userEmail: watchInfo .userEmail,
    productId: watchInfo .productId,
  });

  if (exists) {
    return res.status(400).send({ message: 'Already in watchlist' });
  }

  const result = await watchlistCollection.insertOne(watchInfo);
  res.send(result);
});



// GET price trends for a single item
// GET /api/price-trends/:itemName
app.get("/api/price-trends/:itemName",verifyFBToken, async (req, res) => {
  const { itemName } = req.params;

  try {
    const result = await productCollection.findOne(
      { itemName: itemName, status: "approved" },
      { projection: { prices: 1, marketName: 1, vendorName: 1, image: 1 } }
    );

    if (!result) {
      return res.status(404).json({ message: "Item not found" });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});
// GET /api/tracked-items
app.get("/api/tracked-items",verifyFBToken, async (req, res) => {
  try {
    const items = await productCollection
      .find({ status: "approved" })
      .project({ itemName: 1 })
      .sort({ date: -1 })
      .toArray();

    const uniqueItems = [...new Set(items.map((item) => item.itemName))];

    res.json(uniqueItems);
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});
// GET watchlist items by user email
app.get("/watchlist",verifyFBToken, async (req, res) => {
  try {
    const userEmail = req.query.email;
    if (!userEmail) {
      return res.status(400).json({ message: "Email query parameter is required" });
    }
    if(req.decoded.email !== userEmail){
       return res.status(403).json({ message: 'Unauthorized access' });
    }
    const watchlistItems = await watchlistCollection
      .find({ userEmail })
      .sort({ addedAt: -1 })
      .toArray();

    res.status(200).json(watchlistItems);
  } catch (error) {
    console.error("Failed to fetch watchlist:", error);
    res.status(500).json({ message: "Failed to fetch watchlist" });
  }
});

app.get("/user-orders",verifyFBToken, async (req, res) => {
  try {
    const userEmail = req.query.email;
    if (!userEmail) {
      return res.status(400).json({ message: "Email query parameter is required" });
    }
    if(req.decoded.email !== userEmail){
       return res.status(403).json({ message: 'Unauthorized access' });
    }
    const orders = await ordersCollection
      .find({ userEmail })
      .sort({ paidAt: -1 }) 
      .toArray();

    res.status(200).json(orders);
  } catch (error) {
    console.error("Failed to fetch orders:", error);
    res.status(500).json({ message: "Failed to fetch orders" });
  }
});

// DELETE a watchlist item by its _id
app.delete("/watchlist/:id",verifyFBToken, async (req, res) => {
  try {
    const id = req.params.id;
    
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid watchlist item ID" });
    }
     const userEmail = req.decoded.email;
    const item = await watchlistCollection.findOne({ _id: new ObjectId(id) });
    if (!item) {
      return res.status(404).json({ message: "Watchlist item not found" });
    }

    if (item.userEmail !== userEmail) {
      return res.status(403).json({ message: "Unauthorized access" });
    }
    const result = await watchlistCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 1) {
      res.status(200).json({ message: "Watchlist item removed successfully" });
    } else {
      res.status(404).json({ message: "Watchlist item not found" });
    }
  } catch (error) {
    console.error("Failed to remove watchlist item:", error);
    res.status(500).json({ message: "Failed to remove watchlist item" });
  }
});














    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    //await client.close();
  }
}
run().catch(console.dir);
//

app.get('/', (req, res) => {
  res.send('BazaarTracker BD is running!');
});

app.listen(port, () => {
  console.log(`BazaarTracker BD Server is running on port ${port}`);
});


